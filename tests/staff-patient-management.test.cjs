const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'staff-patient-management.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261103000300_shared_admin_staff_patient_update.sql'), 'utf8');
const accessMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261103000200_staff_patient_management_access.sql'), 'utf8');
const accountMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261103000400_staff_patient_account_status.sql'), 'utf8');
const guardianMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261103000500_fix_patient_guardian_empty_contact_update.sql'), 'utf8');
const announcementAccessMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261028000300_announcement_access_policies.sql'), 'utf8');
const announcementMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261103175337_staff_announcement_insert.sql'), 'utf8');
const announcementLifecycleMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261104000200_announcement_expiration_and_staff_delete.sql'), 'utf8');
const announcementUpdateMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261104000300_staff_announcement_update_own.sql'), 'utf8');
const staffProfileMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261104000400_staff_self_profile_management.sql'), 'utf8');
const clinicalStaffAccessMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261103230338_clinical_staff_patient_access.sql'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { window: {}, document: { getElementById: () => null }, console };
vm.runInNewContext(source, context);
const api = context.window.ERecPassStaffPatients;

test('staff patient helper API initializes', () => {
  assert.equal(typeof api.validateEdit, 'function');
  assert.equal(api.isClinicalStaff('doctor'), true);
  assert.equal(api.isClinicalStaff('nurse'), true);
  assert.equal(api.isClinicalStaff('other'), false);
  assert.equal(api.isClinicalStaff(''), false);
});

test('valid patient edits pass validation', () => {
  assert.equal(api.validateEdit({
    status: 'Green',
    birthDate: '2000-02-29',
    guardianNum: '09171234567',
    doctorNotes: 'Follow-up as scheduled',
    labText: 'CBC reviewed',
    prescription: 'Medication and dosage'
  }, '2026-11-03'), '');
});

test('invalid status, impossible dates, and future dates are rejected', () => {
  assert.match(api.validateEdit({ status: 'Critical' }, '2026-11-03'), /valid patient health status/i);
  assert.match(api.validateEdit({ status: 'Green', birthDate: '2025-02-29' }, '2026-11-03'), /valid date/i);
  assert.match(api.validateEdit({ status: 'Green', birthDate: '2999-01-01' }, '2026-11-03'), /future/i);
});

test('oversized patient fields are rejected', () => {
  assert.match(api.validateEdit({ status: 'Red', guardianNum: '1'.repeat(41) }), /40 characters/i);
  assert.match(api.validateEdit({ status: 'Red', doctorNotes: 'x'.repeat(4001) }), /4,000/i);
  assert.match(api.validateEdit({ status: 'Red', labText: 'x'.repeat(4001) }), /4,000/i);
  assert.match(api.validateEdit({ status: 'Red', prescription: 'x'.repeat(501) }), /500/i);
});

test('active Staff can load a patient and save edits without discarding a newer lab result', async () => {
  class Element {
    constructor(id = '') {
      this.id = id;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.value = '';
      this.files = [];
      this.disabled = false;
      this.hidden = false;
      const classes = new Set(id === 'staffPatientEditModal' ? ['hidden'] : []);
      this.classList = {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle: (name, force) => {
          if (force === undefined ? !classes.has(name) : force) classes.add(name);
          else classes.delete(name);
        }
      };
    }

    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute(name, value) { this.attributes[name] = value; }
    focus() {}
    querySelectorAll() { return this.controls || []; }
  }

  const ids = [
    'staffPatientManagementList', 'staffPatientManagementStatus', 'staffPatientSearch',
    'staffPatientEditModal', 'staffPatientEditName', 'staffPatientEditStatus',
    'staffPatientEditBirthDate', 'staffPatientEditLabText', 'staffPatientEditLabPhoto',
    'staffPatientExistingLabs', 'staffPatientPrescriptionField', 'staffPatientEditPrescription',
    'staffPatientEditDoctorNote', 'staffPatientEditGuardianNum', 'staffPatientSaveButton',
    'staffPatientEditorStatus'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  elements.staffPatientEditModal.controls = [
    elements.staffPatientEditStatus,
    elements.staffPatientEditBirthDate,
    elements.staffPatientEditLabText,
    elements.staffPatientEditLabPhoto,
    elements.staffPatientEditPrescription,
    elements.staffPatientEditDoctorNote,
    elements.staffPatientEditGuardianNum,
    elements.staffPatientSaveButton
  ];

  const oldLab = { date: '2026-10-01', type: 'CBC', result: 'Old result' };
  const concurrentLab = { date: '2026-11-02', type: 'X-ray', result: 'Newer result' };
  const currentPrescription = [{ medicine: 'Doctor approved medicine', active: true }];
  let patientReads = 0;
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'staff-1' } }, error: null }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'staff_list_patients') {
        return { data: [{ id: 'patient-1', full_name: 'Test Patient', status: 'Green' }], error: null };
      }
      if (name === 'staff_get_patient_record') {
        patientReads += 1;
        return {
          data: {
            id: 'patient-1',
            full_name: 'Test Patient',
            status: 'Green',
            birth_date: null,
            guardian_num: '',
            doctor_notes: '',
            lab_results: patientReads === 1 ? [oldLab] : [oldLab, concurrentLab],
            prescriptions: currentPrescription,
            can_edit_prescriptions: false
          },
          error: null
        };
      }
      if (name === 'admin_staff_update_patient_record') {
        return {
          data: {
            id: args.p_patient_id,
            status: args.p_status,
            birth_date: args.p_birth_date,
            guardian_num: args.p_guardian_num || '',
            doctor_notes: args.p_doctor_notes || null,
            lab_results: args.p_lab_results,
            prescriptions: args.p_prescriptions
          },
          error: null
        };
      }
      throw new Error('Unexpected RPC: ' + name);
    }
  };
  const elementsForDocument = {
    getElementById: id => elements[id] || null,
    createElement: tag => new Element(tag),
    addEventListener() {}
  };
  const browser = {
    window: { currentSession: { role: 'staff', data: { account_type: 'nurse' } }, erecpassSupabase: client },
    document: elementsForDocument,
    console
  };
  vm.runInNewContext(source, browser);

  await browser.window.renderStaffPatients();
  const card = elements.staffPatientManagementList.children[0];
  const edit = card.children[1].children[1];
  await edit.listeners.click();
  assert.equal(elements.staffPatientPrescriptionField.hidden, true);
  const removeLab = elements.staffPatientExistingLabs.children[0].children[1];
  removeLab.listeners.click();
  elements.staffPatientEditStatus.value = 'Yellow';
  elements.staffPatientEditBirthDate.value = '2000-02-29';
  elements.staffPatientEditGuardianNum.value = '';
  elements.staffPatientEditDoctorNote.value = 'Follow-up scheduled';
  await browser.window.saveStaffPatientEdit();

  const update = calls.find(call => call.name === 'admin_staff_update_patient_record');
  assert.deepEqual(update.args.p_lab_results, [concurrentLab]);
  assert.deepEqual(update.args.p_prescriptions, currentPrescription);
  assert.equal(update.args.p_status, 'Yellow');
  assert.equal(update.args.p_guardian_num, '');
  assert.equal(elements.staffPatientEditModal.classList.contains('hidden'), true);
  assert.match(elements.staffPatientManagementStatus.textContent, /saved and verified/i);
});

test('active Staff can view linked patient account status but cannot mutate accounts', async () => {
  class Element {
    constructor(id = '') {
      this.id = id;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.value = '';
      this.hidden = false;
    }

    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }

  const ids = [
    'staffPatientAccountsList', 'staffPatientAccountsStatus', 'staffPatientAccountSearch',
    'staffPatientAccountStatusFilter', 'staffPatientAccountVerificationFilter',
    'staffPatientRecordsSection', 'staffPatientAccountsSection',
    'staffPatientRecordsTab', 'staffPatientAccountsTab'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const accounts = [
    { patient_id: 'p-1', full_name: 'Verified Patient', email: 'verified@example.test', account_linked: true, account_active: true, email_verified: true },
    { patient_id: 'p-2', full_name: 'Pending Patient', email: 'pending@example.test', account_linked: true, account_active: false, email_verified: false },
    { patient_id: 'p-3', full_name: 'Unlinked Patient', email: 'unlinked@example.test', account_linked: false, account_active: false, email_verified: null }
  ];
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'staff-1' } }, error: null }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'staff_list_patient_accounts') return { data: accounts, error: null };
      throw new Error('Unexpected RPC: ' + name);
    }
  };
  const browser = {
    window: { currentSession: { role: 'staff', data: { account_type: 'doctor' } }, erecpassSupabase: client },
    document: {
      getElementById: id => elements[id] || null,
      createElement: tag => new Element(tag)
    },
    console
  };
  vm.runInNewContext(source, browser);

  await browser.window.switchStaffPatientSection('accounts');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'staff_list_patient_accounts');
  assert.equal(elements.staffPatientRecordsSection.hidden, true);
  assert.equal(elements.staffPatientAccountsSection.hidden, false);
  assert.equal(elements.staffPatientRecordsTab.attributes['aria-pressed'], 'false');
  assert.equal(elements.staffPatientAccountsTab.attributes['aria-pressed'], 'true');
  assert.equal(elements.staffPatientAccountsList.children.length, 3);
  assert.match(elements.staffPatientAccountsList.children[0].children[1].children[0].textContent, /Active/);
  assert.match(elements.staffPatientAccountsList.children[0].children[1].children[1].textContent, /Verified/);
  assert.match(elements.staffPatientAccountsList.children[2].children[1].children[0].textContent, /Not linked/);

  elements.staffPatientAccountStatusFilter.value = 'deactivated';
  browser.window.renderStaffPatientAccounts();
  assert.equal(elements.staffPatientAccountsList.children.length, 1);
  assert.match(elements.staffPatientAccountsList.children[0].children[1].children[0].textContent, /Deactivated/);
  assert.equal(typeof browser.window.toggleErecpassAdminAccount, 'undefined');
  assert.doesNotMatch(source, /functions\.invoke\(['"]admin-manage-account/);
  assert.match(indexHtml, /role="group" aria-label="Staff patient tools"/);
  assert.match(indexHtml, /aria-pressed="true" aria-controls="staffPatientRecordsSection"/);
  assert.match(indexHtml, /staff-account-permissions/);
});

test('database RPCs enforce active staff authorization and restrict function grants', () => {
  assert.match(accessMigration, /profile\.active is true/);
  assert.match(accessMigration, /staff_account\.active is true/);
  assert.match(accessMigration, /lower\(coalesce\(profile\.role, ''\)\) = 'staff'/);
  assert.match(accessMigration, /can_edit_prescriptions/);
  assert.match(migration, /profile\.role = 'admin' and profile\.active is true/);
  assert.match(migration, /profile\.role = 'staff' and profile\.active is true/);
  assert.match(migration, /only an active Admin or Doctor can update patient prescriptions/i);
  assert.match(migration, /drop function if exists public\.staff_update_patient_record\(text, text, date, text, text, jsonb, jsonb\)/i);
  assert.match(accessMigration, /drop function if exists public\.staff_update_patient_record\(uuid, text, date, text, text, jsonb, jsonb\)/i);
  assert.match(migration, /revoke all on function public\.admin_staff_update_patient_record\(text, text, date, text, text, jsonb, jsonb\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.admin_staff_update_patient_record\(text, text, date, text, text, jsonb, jsonb\) to authenticated/i);
  assert.match(migration, /patient\.id = p_patient_id/);
  assert.match(indexHtml, /client\.rpc\('admin_staff_update_patient_record'/);
  assert.match(source, /client\.rpc\('admin_staff_update_patient_record'/);
});

test('Staff patient-account status is protected by active Staff authorization', () => {
  assert.match(accountMigration, /security definer/i);
  assert.match(accountMigration, /profile\.active is true/);
  assert.match(accountMigration, /staff_account\.active is true/);
  assert.match(accountMigration, /auth\.users/);
  assert.match(accountMigration, /email_confirmed_at/);
  assert.match(accountMigration, /revoke all on function public\.staff_list_patient_accounts\(\) from public, anon/i);
  assert.match(accountMigration, /grant execute on function public\.staff_list_patient_accounts\(\) to authenticated/i);
  assert.match(source, /client\.rpc\('staff_list_patient_accounts'\)/);
  assert.match(indexHtml, /Account edits, password changes, activation, and deletion are Admin-only/);
});

test('patient record access is limited to active Doctors and Nurses', () => {
  assert.match(clinicalStaffAccessMigration, /create or replace function app_private\.is_clinical_staff\(\)[\s\S]*staff_account\.active is true[\s\S]*account_type, ''\)\) in \('doctor', 'nurse'\)/i);
  assert.match(clinicalStaffAccessMigration, /grant execute on function app_private\.is_clinical_staff\(\) to authenticated/i);
  assert.match(clinicalStaffAccessMigration, /create policy patients_select_owner_or_staff[\s\S]*app_private\.is_clinical_staff\(\)/i);
  assert.match(clinicalStaffAccessMigration, /create policy patients_update_staff_admin[\s\S]*app_private\.is_clinical_staff\(\)/i);
  for (const functionName of [
    'staff_list_patients',
    'staff_get_patient_record',
    'staff_update_patient_record',
    'admin_staff_update_patient_record',
    'staff_list_patient_accounts'
  ]) {
    const functionStart = clinicalStaffAccessMigration.indexOf('create or replace function public.' + functionName);
    assert.ok(functionStart >= 0, `${functionName} is updated by the access migration`);
    const functionEnd = clinicalStaffAccessMigration.indexOf('$$;', functionStart);
    assert.ok(functionEnd > functionStart, `${functionName} has a complete definition`);
    assert.match(clinicalStaffAccessMigration.slice(functionStart, functionEnd), /is_clinical_staff\(\)/i, `${functionName} checks clinical Staff status`);
  }
  assert.match(clinicalStaffAccessMigration, /profile\.role = 'admin' and profile\.active is true[\s\S]*app_private\.is_clinical_staff\(\)/i);

  const patientNavigation = indexHtml.slice(
    indexHtml.indexOf("window.staffNavigateTo = function"),
    indexHtml.indexOf("window.addEventListener('pagehide'", indexHtml.indexOf("window.staffNavigateTo = function"))
  );
  assert.match(patientNavigation, /destination === 'patients'[\s\S]*\['doctor', 'nurse'\]\.includes/);
  assert.match(indexHtml, /patientNavigation\.hidden = !canManagePatientRecords/);
  assert.match(source, /if \(!isClinicalStaff\(\)\)[\s\S]*Patient-record management is available only to active Doctors and Nurses/);
});

test('shared patient update stores an empty guardian contact as a non-null empty string', () => {
  assert.match(guardianMigration, /guardian_num = coalesce\(nullif\(btrim\(coalesce\(p_guardian_num, ''\)\), ''\), ''\)/i);
  assert.match(guardianMigration, /revoke all on function public\.admin_staff_update_patient_record/i);
  assert.match(guardianMigration, /grant execute on function public\.admin_staff_update_patient_record/i);
});

test('Staff announcements are insert-only for active Staff and remain Admin-managed otherwise', () => {
  assert.match(announcementMigration, /create\s+policy\s+announcements_active_staff_insert/i);
  assert.match(announcementMigration, /for\s+insert\s+to\s+authenticated/i);
  assert.match(announcementMigration, /created_by\s*=\s*auth\.uid\(\)/i);
  assert.match(announcementMigration, /profile\.active\s+is\s+true[\s\S]*staff_account\.active\s+is\s+true/i);
  assert.doesNotMatch(announcementMigration, /for\s+(update|delete|all)/i);
  assert.match(indexHtml, /id="staffAnnouncementComposer"/);
  assert.match(indexHtml, /openStaffAnnouncementComposer\(\)/);
  assert.match(indexHtml, /modal\.parentElement !== document\.body\) document\.body\.append\(modal\)/);
  assert.match(indexHtml, /#staffAnnouncementComposer \.staff-announcement-composer-heading > button\.staff-secondary-action[\s\S]*width:44px !important;[\s\S]*flex:0 0 44px;/);
  assert.match(indexHtml, /#staffAnnouncementComposer \{[\s\S]*width:100vw;[\s\S]*overflow-x:hidden;/);
  assert.match(indexHtml, /#staffAnnouncementComposer \.staff-secondary-action\s*\{[\s\S]*background:#EAF8ED;/);
  assert.match(indexHtml, /#staffAnnouncementComposer \.staff-primary-action\s*\{[\s\S]*background:#245b35;[\s\S]*color:#fff;/);
  assert.match(indexHtml, /#staffApp \.staff-announcement-create-button :is\(span,i\)\s*\{\s*color:#fff !important;\s*-webkit-text-fill-color:#fff !important;/);
  assert.match(indexHtml, /async function submitStaffAnnouncement/);
  assert.match(indexHtml, /staff-patient-remove-lab[\s\S]*background:#9f2631;[\s\S]*color:#fff;/);
  assert.match(indexHtml, /#staffPatientEditStatus:focus-visible\s*\{\s*outline:2px solid/);
  assert.match(indexHtml, /#staffApp \.staff-appointments-list > \.appointment-card/);
  assert.match(indexHtml, /#staffApp #staffMedicationWorkflow #nurseMedicationCompose > \.staff-primary-action/);
});

test('Announcements support expiry and active Staff can delete only their own', () => {
  assert.match(announcementAccessMigration, /create policy erecpass_active_admin_manage_announcements[\s\S]*for all[\s\S]*p\.role = 'admin'[\s\S]*p\.active is true/i);
  assert.match(announcementLifecycleMigration, /add column if not exists expires_at timestamptz/i);
  assert.match(announcementLifecycleMigration, /create policy announcements_active_staff_delete_own[\s\S]*for delete[\s\S]*to authenticated/i);
  assert.match(announcementLifecycleMigration, /created_by = auth\.uid\(\)[\s\S]*profile\.active is true[\s\S]*staff_account\.active is true/i);
  assert.match(indexHtml, /id="staffAnnouncementExpirationDate" type="date"/);
  assert.match(indexHtml, /id="staffAnnouncementNoExpiration" type="checkbox"/);
  assert.match(indexHtml, /id="adminAnnouncementExpirationDate" type="date"/);
  assert.match(indexHtml, /id="adminAnnouncementNoExpiration" type="checkbox"/);
  assert.match(indexHtml, /expires_at:\s*expiresAt/);
  assert.match(indexHtml, /function announcementExpirationFromDate/);
  assert.match(indexHtml, /function isAnnouncementActive/);
  assert.match(indexHtml, /function formatAnnouncementExpiration/);
  assert.match(indexHtml, /select\('user_id,name'\)[\s\S]*in\('user_id', authorIds\)/);
  assert.match(indexHtml, /author_name: staffByUserId\.get\(String\(row\.created_by \|\| ''\)\) \|\| 'Admin'/);
  assert.match(indexHtml, /Posted by \$\{escapeStaffDashboardText\(a\.author_name \|\| 'Admin'\)\}/);
  assert.match(announcementUpdateMigration, /create policy announcements_active_staff_update_own[\s\S]*for update[\s\S]*to authenticated/i);
  assert.match(announcementUpdateMigration, /created_by = auth\.uid\(\)[\s\S]*profile\.active is true[\s\S]*staff_account\.active is true/i);
  assert.match(indexHtml, /function announcementActionsMenu/);
  assert.match(indexHtml, /This older announcement is not linked to a Supabase record/);
  assert.match(indexHtml, /const actionsMenu = announcementActionsMenu\(a\.db_id, 'staff', !!canDelete\)/);
  assert.match(indexHtml, /openAnnouncementEditor\(/);
  assert.match(indexHtml, /async function saveAnnouncementEdit/);
  const adminDeleteHandler = indexHtml.slice(
    indexHtml.indexOf('async function deleteAdminAnnouncement'),
    indexHtml.indexOf('async function adminPostAnnouncement')
  );
  assert.match(adminDeleteHandler, /String\(currentSession\?\.role \|\| ''\)\.toLowerCase\(\)/);
  assert.match(adminDeleteHandler, /profile\.data\?\.role !== 'admin' \|\| profile\.data\?\.active !== true/);
  assert.doesNotMatch(adminDeleteHandler, /admin2@gmail\.com/i);
  assert.match(indexHtml, /announcement-actions-menu-items[\s\S]*Edit announcement[\s\S]*announcement-actions-delete/);
  assert.match(indexHtml, /@media\(max-width:400px\)[\s\S]*staff-announcement-card-heading[\s\S]*staff-updates-disclosure/);
  assert.match(indexHtml, /color:#fff !important;[\s\S]*-webkit-text-fill-color:#fff !important;[\s\S]*#staffApp \.staff-announcement-create-button \*/);
});

test('Staff profile menu edits own basic details and only removes own photo', () => {
  assert.match(staffProfileMigration, /create or replace function public\.update_own_staff_profile/i);
  assert.match(staffProfileMigration, /staff_account\.user_id = auth\.uid\(\)[\s\S]*staff_account\.active is true[\s\S]*profile\.role = 'staff'[\s\S]*profile\.active is true/i);
  assert.match(staffProfileMigration, /set name = v_name,[\s\S]*role_title = v_title,[\s\S]*professional_title = v_title,[\s\S]*task = v_task/i);
  assert.match(staffProfileMigration, /grant execute on function public\.update_own_staff_profile\(text, text, text\) to authenticated/i);
  assert.match(staffProfileMigration, /create or replace function public\.remove_own_staff_photo\(\)/i);
  assert.match(staffProfileMigration, /set photo = null[\s\S]*staff_account\.user_id = auth\.uid\(\)[\s\S]*staff_account\.active is true/i);
  assert.match(staffProfileMigration, /grant execute on function public\.remove_own_staff_photo\(\) to authenticated/i);
  assert.match(indexHtml, /class="announcement-actions-menu staff-profile-actions-menu"/);
  assert.match(indexHtml, /#staffApp \.staff-profile-actions-menu \.announcement-actions-menu-items\s*\{[\s\S]*background:rgba\(255,255,255,\.58\);[\s\S]*backdrop-filter:blur\(8px\)/);
  assert.match(indexHtml, /<span>Edit profile<\/span>[\s\S]*<span>Change picture<\/span>[\s\S]*<span>Delete photo<\/span>/);
  assert.match(indexHtml, /id="staffProfileEditor"/);
  assert.match(indexHtml, /id="staffProfileEditName" type="text"/);
  assert.match(indexHtml, /id="staffProfileEditTitle" type="text"/);
  assert.match(indexHtml, /id="staffProfileEditTask" type="text"/);
  assert.match(indexHtml, /id="staffProfileEditEmail" type="email" readonly/);
  assert.match(indexHtml, /client\.rpc\('update_own_staff_profile'/);
  assert.match(indexHtml, /client\.rpc\('remove_own_staff_photo'\)/);
});

test('Staff bottom-navigation labels compact without wrapping on narrow screens', () => {
  assert.match(indexHtml, /@media\s*\(max-width:\s*420px\)\s*\{[\s\S]*staffBottomNav button span[\s\S]*font-size:0 !important;[\s\S]*staffBottomNav button span::after[\s\S]*content:attr\(data-compact-label\)/);
  assert.match(indexHtml, /aria-label="Appointments"[^>]*>[\s\S]*data-compact-label="Appts">Appointments/);
  assert.match(indexHtml, /aria-label="QR Scanner"[^>]*>[\s\S]*data-compact-label="QR">QR Scanner/);
});

test('patient management script is loaded by the application, not the printable ID template', () => {
  const printTemplateStart = indexHtml.indexOf('const printableDocument = `');
  const printTemplateEnd = indexHtml.indexOf('`;', printTemplateStart);
  const scriptPosition = indexHtml.indexOf('<script src="./staff-patient-management.js"></script>');
  assert.ok(printTemplateStart >= 0);
  assert.ok(printTemplateEnd > printTemplateStart);
  assert.ok(scriptPosition > printTemplateEnd);
});

test('Admin and Staff patient editors use the same database update RPC', () => {
  const adminSaveStart = indexHtml.indexOf('async function saveAdminPatientEdit() {');
  const adminSaveEnd = indexHtml.indexOf('\nasync function adminCreateStaffAccount()', adminSaveStart);
  const adminSave = indexHtml.slice(adminSaveStart, adminSaveEnd);
  assert.ok(adminSaveStart >= 0);
  assert.ok(adminSaveEnd > adminSaveStart);
  assert.match(adminSave, /client\.rpc\('admin_staff_update_patient_record'/);
  assert.doesNotMatch(adminSave, /\.from\('patients'\)\s*\.update\(/);
  assert.match(source, /client\.rpc\('admin_staff_update_patient_record'/);
  assert.match(migration, /update public\.patients as patient/);
});
