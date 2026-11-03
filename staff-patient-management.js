(function () {
  'use strict';

  const byId = id => document.getElementById(id);
  const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);

  function validateEdit(values) {
    const status = String(values.status || '');
    if (!['Green', 'Yellow', 'Red'].includes(status)) return 'Choose a valid patient health status.';
    const birthDate = String(values.birthDate || '').trim();
    if (birthDate) {
      const parsed = new Date(birthDate + 'T00:00:00');
      if (Number.isNaN(parsed.getTime())) return 'Enter a valid date of birth.';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (parsed > today) return 'Date of birth cannot be in the future.';
    }
    if (String(values.guardianNum || '').length > 40) return 'Guardian contact number is too long.';
    if (String(values.doctorNotes || '').length > 4000) return 'Doctor notes must be 4,000 characters or fewer.';
    return '';
  }

  let activePatient = null;
  let removedLabEntries = [];

  function setStatus(message, isError) {
    const node = byId('staffPatientManagementStatus');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.state = isError ? 'error' : 'success';
  }

  async function assertActiveStaff() {
    if (window.currentSession?.role !== 'staff') {
      throw new Error('Only signed-in Staff accounts can manage patient records.');
    }
    const client = window.erecpassSupabase;
    if (!client?.auth || !client?.from || !client?.rpc) {
      throw new Error('Supabase is not ready. Refresh the app and sign in again.');
    }
    const auth = await client.auth.getUser();
    if (auth.error) throw auth.error;
    const userId = auth.data?.user?.id;
    if (!userId) throw new Error('Your Staff session has expired. Sign in again.');
    const profile = await client.from('profiles')
      .select('role,active')
      .eq('id', userId)
      .maybeSingle();
    if (profile.error) throw profile.error;
    if (String(profile.data?.role || '').toLowerCase() !== 'staff' || profile.data?.active !== true) {
      throw new Error('An active Staff account is required to manage patients.');
    }
    return client;
  }

  function patientCard(patient) {
    const card = document.createElement('article');
    card.className = 'staff-patient-card';
    const copy = document.createElement('div');
    copy.className = 'staff-patient-card-copy';
    const heading = document.createElement('strong');
    heading.textContent = patient.full_name || 'Unnamed Patient';
    const details = document.createElement('p');
    details.textContent = 'ID: ' + patient.id + ' · ' + (patient.email || 'No email');
    const guardian = document.createElement('p');
    guardian.textContent = 'Guardian: ' + (patient.guardian_num || 'Not provided');
    const badge = document.createElement('span');
    badge.className = 'staff-patient-status status-' + String(patient.status || 'Green').toLowerCase();
    badge.textContent = patient.status || 'Green';
    copy.append(heading, details, guardian);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'staff-primary-action';
    edit.textContent = 'Edit Patient File';
    edit.addEventListener('click', () => openPatientEditor(patient.id));
    const right = document.createElement('div');
    right.className = 'staff-patient-card-actions';
    right.append(badge, edit);
    card.append(copy, right);
    return card;
  }

  async function renderStaffPatients() {
    const container = byId('staffPatientManagementList');
    if (!container) return;
    container.replaceChildren();
    setStatus('Loading patient records from Supabase…', false);
    try {
      const client = await assertActiveStaff();
      const result = await client.from('patients')
        .select('id,full_name,email,guardian_num,status,birth_date,age,age_category')
        .order('full_name', { ascending: true });
      if (result.error) throw result.error;
      const search = String(byId('staffPatientSearch')?.value || '').trim().toLowerCase();
      const patients = (result.data || []).filter(patient => {
        const haystack = [patient.full_name, patient.id, patient.email, patient.status, patient.guardian_num]
          .map(value => String(value || '').toLowerCase()).join(' ');
        return haystack.includes(search);
      });
      if (!patients.length) {
        const empty = document.createElement('p');
        empty.className = 'staff-patient-empty';
        empty.textContent = search ? 'No patient records match your search.' : 'No patient records are available to this Staff account.';
        container.append(empty);
      } else {
        patients.forEach(patient => container.append(patientCard(patient)));
      }
      setStatus(patients.length + ' patient record(s) loaded.', false);
    } catch (error) {
      console.error('[ERecPass] Staff patient list failed:', error);
      const message = document.createElement('p');
      message.className = 'staff-patient-error';
      message.textContent = error?.message || 'Could not load patient records.';
      container.append(message);
      setStatus(message.textContent, true);
    }
  }

  function renderLabEntries(labs) {
    const container = byId('staffPatientExistingLabs');
    if (!container) return;
    container.replaceChildren();
    if (!labs.length) {
      const empty = document.createElement('p');
      empty.className = 'staff-patient-empty';
      empty.textContent = 'No laboratory results saved.';
      container.append(empty);
      return;
    }
    labs.forEach((lab, index) => {
      const row = document.createElement('div');
      row.className = 'staff-patient-lab-row';
      const description = document.createElement('span');
      description.textContent = (lab?.type || 'Laboratory Result') + ' · ' +
        (lab?.date || 'No date') + ' · ' + (lab?.result || (lab?.photo ? 'Photo attached' : 'No details'));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'staff-patient-remove-lab';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        if (!activePatient) return;
        const entry = activePatient.labResults[index];
        if (entry) removedLabEntries.push(JSON.stringify(entry));
        activePatient.labResults.splice(index, 1);
        renderLabEntries(activePatient.labResults);
      });
      row.append(description, remove);
      container.append(row);
    });
  }

  async function openPatientEditor(patientId) {
    try {
      const client = await assertActiveStaff();
      const result = await client.from('patients').select('*').eq('id', patientId).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Patient record was not found. Refresh the list and try again.');
      const patient = result.data;
      activePatient = {
        id: patient.id,
        labResults: Array.isArray(patient.lab_results) ? patient.lab_results.slice() : []
      };
      removedLabEntries = [];
      byId('staffPatientEditId').value = String(patient.id);
      byId('staffPatientEditName').textContent = patient.full_name || 'Patient';
      byId('staffPatientEditStatus').value = patient.status || 'Green';
      byId('staffPatientEditBirthDate').value = patient.birth_date || '';
      const today = new Date();
      byId('staffPatientEditBirthDate').max = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
      byId('staffPatientEditPrescription').value = patient.prescriptions?.[0]?.medicine || '';
      byId('staffPatientEditDoctorNote').value = patient.doctor_notes || '';
      byId('staffPatientEditGuardianNum').value = patient.guardian_num || '';
      byId('staffPatientEditLabText').value = '';
      byId('staffPatientEditLabPhoto').value = '';
      renderLabEntries(activePatient.labResults);
      setStatus('', false);
      byId('staffPatientEditModal').classList.remove('hidden');
      byId('staffPatientEditModal').setAttribute('aria-hidden', 'false');
    } catch (error) {
      console.error('[ERecPass] Staff patient editor failed:', error);
      setStatus(error?.message || 'Could not open this patient record.', true);
      alert(error?.message || 'Could not open this patient record.');
    }
  }

  function closePatientEditor() {
    const modal = byId('staffPatientEditModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    activePatient = null;
    removedLabEntries = [];
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(String(event.target?.result || ''));
      reader.onerror = () => reject(new Error('Could not read the selected lab-result image.'));
      reader.readAsDataURL(file);
    });
  }

  async function savePatientEdit() {
    const saveButton = byId('staffPatientSaveButton');
    if (!activePatient) {
      setStatus('Open a patient record before saving.', true);
      return;
    }
    const values = {
      status: byId('staffPatientEditStatus')?.value || '',
      birthDate: byId('staffPatientEditBirthDate')?.value || '',
      guardianNum: String(byId('staffPatientEditGuardianNum')?.value || '').trim(),
      doctorNotes: String(byId('staffPatientEditDoctorNote')?.value || '').trim()
    };
    const validationError = validateEdit(values);
    if (validationError) {
      setStatus(validationError, true);
      alert(validationError);
      return;
    }
    const photoFile = byId('staffPatientEditLabPhoto')?.files?.[0] || null;
    if (photoFile && (!photoFile.type?.startsWith('image/') || photoFile.size > 2 * 1024 * 1024)) {
      const message = 'Choose an image file no larger than 2 MB.';
      setStatus(message, true);
      alert(message);
      return;
    }
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'SAVING…';
    }
    try {
      const client = await assertActiveStaff();
      const patientId = String(activePatient.id);
      const latest = await client.from('patients')
        .select('id,lab_results,prescriptions')
        .eq('id', patientId)
        .maybeSingle();
      if (latest.error) throw latest.error;
      if (!latest.data) throw new Error('Patient record was not found in Supabase.');

      let labs = Array.isArray(latest.data.lab_results) ? latest.data.lab_results.slice() : [];
      removedLabEntries.forEach(signature => {
        const index = labs.findIndex(entry => JSON.stringify(entry) === signature);
        if (index >= 0) labs.splice(index, 1);
      });
      const labText = String(byId('staffPatientEditLabText')?.value || '').trim();
      const photoData = photoFile ? await readImage(photoFile) : '';
      if (labText || photoData) {
        labs.push({
          date: new Date().toISOString().slice(0, 10),
          type: 'Laboratory Result',
          result: labText || 'Result Attachment',
          photo: photoData
        });
      }

      let prescriptions = Array.isArray(latest.data.prescriptions) ? latest.data.prescriptions.slice() : [];
      const prescriptionText = String(byId('staffPatientEditPrescription')?.value || '').trim();
      if (prescriptionText) {
        prescriptions = [{
          medicine: prescriptionText,
          dosage: 'As prescribed',
          days: 'Active',
          active: true
        }];
      }

      const update = await client.rpc('staff_update_patient_record', {
        p_patient_id: patientId,
        p_status: values.status,
        p_birth_date: values.birthDate || null,
        p_guardian_num: values.guardianNum || null,
        p_doctor_notes: values.doctorNotes || null,
        p_lab_results: labs,
        p_prescriptions: prescriptions
      });
      if (update.error) throw update.error;
      if (!update.data) throw new Error('Supabase did not confirm the patient update.');

      const verified = await client.from('patients')
        .select('id,status,lab_results,prescriptions,doctor_notes,guardian_num,birth_date')
        .eq('id', patientId)
        .maybeSingle();
      if (verified.error) throw verified.error;
      if (!verified.data) throw new Error('The updated patient record could not be verified.');
      if (verified.data.status !== values.status ||
          JSON.stringify(verified.data.lab_results || []) !== JSON.stringify(labs) ||
          JSON.stringify(verified.data.prescriptions || []) !== JSON.stringify(prescriptions) ||
          String(verified.data.guardian_num || '') !== values.guardianNum ||
          String(verified.data.doctor_notes || '') !== values.doctorNotes ||
          String(verified.data.birth_date || '') !== values.birthDate) {
        throw new Error('The saved patient data did not match the verification read. Refresh and try again.');
      }

      closePatientEditor();
      setStatus('Patient record saved and verified in Supabase.', false);
      await renderStaffPatients();
      alert('Patient record saved and verified in Supabase.');
    } catch (error) {
      console.error('[ERecPass] Staff patient save failed:', error);
      setStatus(error?.message || 'Could not save the patient record.', true);
      alert('Could not save the patient record: ' + (error?.message || 'Please try again.'));
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Changes';
      }
    }
  }

  window.ERecPassStaffPatients = { escapeHTML, validateEdit };
  window.renderStaffPatients = renderStaffPatients;
  window.openStaffPatientEditor = openPatientEditor;
  window.saveStaffPatientEdit = savePatientEdit;
  window.closeStaffPatientEditor = closePatientEditor;

  const originalNavigate = window.staffNavigateTo;
  if (typeof originalNavigate === 'function' && !originalNavigate.__staffPatientsWrapped) {
    const wrappedNavigate = function (destination) {
      const result = originalNavigate.call(this, destination);
      if (result && destination === 'patients') renderStaffPatients();
      return result;
    };
    wrappedNavigate.__staffPatientsWrapped = true;
    window.staffNavigateTo = wrappedNavigate;
  }
})();