(function () {
  'use strict';

  const byId = id => document.getElementById(id);
  const MAX_LAB_PHOTO_BYTES = 2 * 1024 * 1024;
  const isClinicalStaff = accountType => ['doctor', 'nurse'].includes(String(
    accountType ?? window.currentSession?.data?.account_type ?? ''
  ).toLowerCase());
  let activePatient = null;
  let listRequest = 0;
  let accountRequest = 0;
  let patientAccounts = [];

  function switchPatientSection(section) {
    const showAccounts = section === 'accounts';
    const records = byId('staffPatientRecordsSection');
    const accounts = byId('staffPatientAccountsSection');
    const recordsTab = byId('staffPatientRecordsTab');
    const accountsTab = byId('staffPatientAccountsTab');
    if (!records || !accounts || !recordsTab || !accountsTab) return;
    records.hidden = showAccounts;
    accounts.hidden = !showAccounts;
    recordsTab.setAttribute('aria-pressed', String(!showAccounts));
    accountsTab.setAttribute('aria-pressed', String(showAccounts));
    return showAccounts ? loadStaffPatientAccounts() : renderStaffPatients();
  }

  function localDateString(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function validateEdit(values, today = localDateString(new Date())) {
    if (!['Green', 'Yellow', 'Red'].includes(String(values.status || ''))) {
      return 'Choose a valid patient health status.';
    }

    const birthDate = String(values.birthDate || '').trim();
    if (birthDate) {
      const parsed = new Date(birthDate + 'T00:00:00.000Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
          Number.isNaN(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== birthDate) {
        return 'Enter a valid date of birth.';
      }
      if (birthDate > today) return 'Date of birth cannot be in the future.';
    }

    if (String(values.guardianNum || '').length > 40) return 'Guardian contact number must be 40 characters or fewer.';
    if (String(values.doctorNotes || '').length > 4000) return 'Doctor notes must be 4,000 characters or fewer.';
    if (String(values.labText || '').length > 4000) return 'Laboratory notes must be 4,000 characters or fewer.';
    if (String(values.prescription || '').length > 500) return 'Prescription must be 500 characters or fewer.';
    return '';
  }

  function setStatus(message, state) {
    const modal = byId('staffPatientEditModal');
    const status = modal && !modal.classList.contains('hidden')
      ? byId('staffPatientEditorStatus')
      : byId('staffPatientManagementStatus');
    if (!status) return;
    status.textContent = message || '';
    status.dataset.state = state || '';
  }

  async function assertActiveStaff() {
    if (window.currentSession?.role !== 'staff') {
      throw new Error('Only signed-in Staff accounts can manage patient records.');
    }
    if (!isClinicalStaff()) {
      throw new Error('Patient-record management is available only to active Doctors and Nurses.');
    }
    const client = window.erecpassSupabase;
    if (!client?.auth?.getUser || !client?.rpc) {
      throw new Error('Supabase is not ready. Refresh the app and sign in again.');
    }
    const auth = await client.auth.getUser();
    if (auth.error) throw auth.error;
    if (!auth.data?.user?.id) throw new Error('Your Staff session has expired. Sign in again.');
    return client;
  }

  function patientCard(patient) {
    const card = document.createElement('article');
    card.className = 'staff-patient-card';

    const details = document.createElement('div');
    details.className = 'staff-patient-card-copy';
    const name = document.createElement('strong');
    name.textContent = patient.full_name || 'Unnamed Patient';
    const identity = document.createElement('p');
    identity.textContent = 'ID: ' + patient.id + ' · ' + (patient.email || 'No email');
    const guardian = document.createElement('p');
    guardian.textContent = 'Guardian: ' + (patient.guardian_num || 'Not provided');
    details.append(name, identity, guardian);

    const actions = document.createElement('div');
    actions.className = 'staff-patient-card-actions';
    const status = document.createElement('span');
    const statusName = ['Green', 'Yellow', 'Red'].includes(patient.status) ? patient.status : 'Green';
    status.className = 'staff-patient-status status-' + statusName.toLowerCase();
    status.textContent = statusName;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'staff-primary-action';
    edit.textContent = 'Edit Patient File';
    edit.addEventListener('click', () => openPatientEditor(patient.id));
    actions.append(status, edit);
    card.append(details, actions);
    return card;
  }

  async function renderStaffPatients() {
    const container = byId('staffPatientManagementList');
    if (!container) return;
    const request = ++listRequest;
    const search = String(byId('staffPatientSearch')?.value || '').trim();
    container.replaceChildren();
    setStatus('Loading patient records…', 'loading');

    try {
      const client = await assertActiveStaff();
      const result = await client.rpc('staff_list_patients', { p_search: search });
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new Error('Patient list response was invalid.');
      if (request !== listRequest) return;

      if (!result.data.length) {
        const empty = document.createElement('p');
        empty.className = 'staff-patient-empty';
        empty.textContent = search ? 'No patient records match your search.' : 'No patient records are available.';
        container.append(empty);
      } else {
        result.data.forEach(patient => container.append(patientCard(patient)));
      }
      setStatus(result.data.length + ' patient record(s) loaded.', 'success');
    } catch (error) {
      if (request !== listRequest) return;
      console.error('[ERecPass] Staff patient list failed:', error);
      const message = document.createElement('p');
      message.className = 'staff-patient-error';
      message.textContent = error?.message || 'Could not load patient records.';
      container.append(message);
      setStatus(message.textContent, 'error');
    }
  }

  function renderPatientAccounts() {
    const container = byId('staffPatientAccountsList');
    if (!container) return;
    const search = String(byId('staffPatientAccountSearch')?.value || '').trim().toLowerCase();
    const statusFilter = byId('staffPatientAccountStatusFilter')?.value || 'all';
    const verificationFilter = byId('staffPatientAccountVerificationFilter')?.value || 'all';
    const rows = patientAccounts.filter(account => {
      const linked = account.account_linked === true;
      const active = linked && account.account_active === true;
      const verified = linked && account.email_verified === true;
      const searchText = [account.patient_id, account.full_name, account.email].join(' ').toLowerCase();
      const statusMatches = statusFilter === 'all' ||
        (statusFilter === 'active' && active) ||
        (statusFilter === 'deactivated' && linked && !active) ||
        (statusFilter === 'unlinked' && !linked);
      const verificationMatches = verificationFilter === 'all' ||
        (verificationFilter === 'verified' && verified) ||
        (verificationFilter === 'unverified' && linked && account.email_verified === false) ||
        (verificationFilter === 'unlinked' && !linked);
      return statusMatches && verificationMatches && (!search || searchText.includes(search));
    });

    container.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'staff-patient-empty';
      empty.textContent = patientAccounts.length
        ? 'No patient accounts match these filters.'
        : 'No patient accounts are available.';
      container.append(empty);
      return;
    }

    rows.forEach(account => {
      const linked = account.account_linked === true;
      const card = document.createElement('article');
      card.className = 'staff-patient-card';
      const details = document.createElement('div');
      details.className = 'staff-patient-card-copy';
      const name = document.createElement('strong');
      name.textContent = account.full_name || 'Unnamed Patient';
      const identity = document.createElement('p');
      identity.textContent = 'Patient ID: ' + (account.patient_id || 'Unavailable') + ' · ' + (account.email || 'No email');
      details.append(name, identity);

      const status = document.createElement('span');
      const isActive = linked && account.account_active === true;
      status.className = 'staff-patient-status ' + (isActive ? 'status-green' : 'status-red');
      status.textContent = !linked ? 'Not linked' : isActive ? 'Active' : 'Deactivated';
      const verified = document.createElement('span');
      verified.className = 'staff-patient-status ' +
        (account.email_verified === true ? 'status-green' : 'status-yellow');
      verified.textContent = !linked ? 'Unlinked' : account.email_verified === true ? 'Verified' : 'Unverified';
      const statusContainer = document.createElement('div');
      statusContainer.className = 'staff-patient-account-badges';
      statusContainer.append(status, verified);
      card.append(details, statusContainer);
      container.append(card);
    });
  }

  async function loadStaffPatientAccounts() {
    const container = byId('staffPatientAccountsList');
    const status = byId('staffPatientAccountsStatus');
    if (!container || !status) return;
    const request = ++accountRequest;
    container.replaceChildren();
    status.textContent = 'Loading patient accounts…';
    status.dataset.state = 'loading';

    try {
      const client = await assertActiveStaff();
      const result = await client.rpc('staff_list_patient_accounts');
      if (result.error) throw result.error;
      if (!Array.isArray(result.data) ||
          result.data.some(account => !account || typeof account.patient_id !== 'string')) {
        throw new Error('Patient account list response was invalid.');
      }
      if (request !== accountRequest) return;
      patientAccounts = result.data;
      renderPatientAccounts();
      status.textContent = patientAccounts.length + ' patient account record(s) loaded.';
      status.dataset.state = 'success';
    } catch (error) {
      if (request !== accountRequest) return;
      console.error('[ERecPass] Staff patient accounts failed:', error);
      const message = document.createElement('p');
      message.className = 'staff-patient-error';
      message.textContent = error?.message || 'Could not load patient accounts.';
      container.append(message);
      status.textContent = message.textContent;
      status.dataset.state = 'error';
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
        activePatient.removedLabEntries.push(stableJSON(activePatient.labResults[index]));
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
      const result = await client.rpc('staff_get_patient_record', { p_patient_id: String(patientId) });
      if (result.error) throw result.error;
      const patient = result.data;
      if (!patient || String(patient.id) !== String(patientId)) {
        throw new Error('Patient record was not found. Refresh the list and try again.');
      }

      activePatient = {
        id: String(patient.id),
        labResults: Array.isArray(patient.lab_results) ? patient.lab_results.slice() : [],
        removedLabEntries: []
      };
      byId('staffPatientEditName').textContent = patient.full_name || 'Patient';
      byId('staffPatientEditStatus').value = patient.status || 'Green';
      byId('staffPatientEditBirthDate').value = patient.birth_date || '';
      byId('staffPatientEditBirthDate').max = localDateString(new Date());
      byId('staffPatientEditLabText').value = '';
      byId('staffPatientEditLabPhoto').value = '';
      const prescriptionField = byId('staffPatientPrescriptionField');
      const canEditPrescriptions = patient.can_edit_prescriptions === true;
      prescriptionField.hidden = !canEditPrescriptions;
      prescriptionField.classList.toggle('hidden', !canEditPrescriptions);
      byId('staffPatientEditPrescription').value = canEditPrescriptions
        ? patient.prescriptions?.[0]?.medicine || ''
        : '';
      byId('staffPatientEditDoctorNote').value = patient.doctor_notes || '';
      byId('staffPatientEditGuardianNum').value = patient.guardian_num || '';
      renderLabEntries(activePatient.labResults);
      const modal = byId('staffPatientEditModal');
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      byId('staffPatientEditStatus').focus();
    } catch (error) {
      console.error('[ERecPass] Staff patient record load failed:', error);
      setStatus(error?.message || 'Could not load the patient record.', 'error');
    }
  }

  function closeStaffPatientEditor(force) {
    if (!force && byId('staffPatientSaveButton')?.disabled) return;
    const modal = byId('staffPatientEditModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    activePatient = null;
  }

  function readLabPhoto(file) {
    if (!file) return Promise.resolve('');
    if (!file.type || !file.type.startsWith('image/')) {
      return Promise.reject(new Error('Please choose a valid lab result image.'));
    }
    if (file.size > MAX_LAB_PHOTO_BYTES) {
      return Promise.reject(new Error('Lab result photos must be 2 MB or smaller.'));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target?.result || '');
      reader.onerror = () => reject(new Error('Could not read the lab result photo.'));
      reader.readAsDataURL(file);
    });
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
    }
    return value;
  }

  function stableJSON(value) {
    return JSON.stringify(canonicalize(value));
  }

  async function saveStaffPatientEdit() {
    if (!activePatient) {
      setStatus('Select a patient before saving.', 'error');
      return;
    }
    const values = {
      status: byId('staffPatientEditStatus').value,
      birthDate: byId('staffPatientEditBirthDate').value,
      guardianNum: byId('staffPatientEditGuardianNum').value.trim(),
      doctorNotes: byId('staffPatientEditDoctorNote').value.trim(),
      labText: byId('staffPatientEditLabText').value.trim(),
      prescription: byId('staffPatientEditPrescription').value.trim()
    };
    const validationError = validateEdit(values);
    if (validationError) {
      setStatus(validationError, 'error');
      return;
    }

    const button = byId('staffPatientSaveButton');
    button.disabled = true;
    button.textContent = 'Saving…';
    byId('staffPatientEditModal').querySelectorAll('input, select, textarea, button').forEach(control => {
      control.disabled = true;
    });
    try {
      const photo = await readLabPhoto(byId('staffPatientEditLabPhoto').files?.[0]);
      const patientId = activePatient.id;
      const client = await assertActiveStaff();
      const latest = await client.rpc('staff_get_patient_record', { p_patient_id: patientId });
      if (latest.error) throw latest.error;
      if (!latest.data || String(latest.data.id) !== patientId) {
        throw new Error('Patient record was not found. Refresh the list and try again.');
      }

      const labs = Array.isArray(latest.data.lab_results) ? latest.data.lab_results.slice() : [];
      activePatient.removedLabEntries.forEach(removed => {
        const index = labs.findIndex(lab => stableJSON(lab) === removed);
        if (index >= 0) labs.splice(index, 1);
      });
      if (values.labText || photo) {
        labs.push({
          date: localDateString(new Date()),
          type: 'Laboratory Result',
          result: values.labText || 'Result Attachment',
          photo
        });
      }
      const prescriptions = Array.isArray(latest.data.prescriptions) ? latest.data.prescriptions.slice() : [];
      if (values.prescription) {
        prescriptions.splice(0, prescriptions.length, {
          medicine: values.prescription,
          dosage: 'As prescribed',
          days: 'Active',
          active: true
        });
      }

      const result = await client.rpc('admin_staff_update_patient_record', {
        p_patient_id: patientId,
        p_status: values.status,
        p_birth_date: values.birthDate || null,
        p_guardian_num: values.guardianNum,
        p_doctor_notes: values.doctorNotes,
        p_lab_results: labs,
        p_prescriptions: prescriptions
      });
      if (result.error) throw result.error;
      if (!result.data || String(result.data.id) !== patientId) {
        throw new Error('Supabase did not confirm the patient record save.');
      }
      if (result.data.status !== values.status ||
          (result.data.birth_date || null) !== (values.birthDate || null) ||
          (result.data.guardian_num || null) !== (values.guardianNum || null) ||
          (result.data.doctor_notes || null) !== (values.doctorNotes || null) ||
          stableJSON(result.data.lab_results || []) !== stableJSON(labs) ||
          stableJSON(result.data.prescriptions || []) !== stableJSON(prescriptions)) {
        throw new Error('Patient record save verification failed. Please refresh and try again.');
      }

      closeStaffPatientEditor(true);
      await renderStaffPatients();
      setStatus('Patient record saved and verified in Supabase.', 'success');
      byId('staffPatientEditLabText').value = '';
      byId('staffPatientEditLabPhoto').value = '';
    } catch (error) {
      console.error('[ERecPass] Staff patient record save failed:', error);
      setStatus(error?.message || 'Could not save the patient record.', 'error');
    } finally {
      byId('staffPatientEditModal').querySelectorAll('input, select, textarea, button').forEach(control => {
        control.disabled = false;
      });
      button.disabled = false;
      button.textContent = 'Save Changes';
    }
  }

  window.renderStaffPatients = renderStaffPatients;
  window.renderStaffPatientAccounts = renderPatientAccounts;
  window.refreshStaffPatientAccounts = loadStaffPatientAccounts;
  window.switchStaffPatientSection = switchPatientSection;
  window.openStaffPatientEditor = openPatientEditor;
  window.closeStaffPatientEditor = closeStaffPatientEditor;
  window.saveStaffPatientEdit = saveStaffPatientEdit;
  window.ERecPassStaffPatients = { validateEdit, isClinicalStaff };

  const modal = byId('staffPatientEditModal');
  if (modal) {
    modal.addEventListener('click', event => {
      if (event.target === modal) closeStaffPatientEditor();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeStaffPatientEditor();
    });
  }
})();
