const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'staff-patient-management.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261103000100_staff_patient_management.sql'), 'utf8');
const updatePolicyMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261104000600_patient_staff_update_via_rpc.sql'), 'utf8');
const context = {
  window: {},
  document: { getElementById() { return null; } },
  console,
  Date,
  Promise,
  String,
  Number,
  JSON
};
vm.runInNewContext(source, context);
const api = context.window.ERecPassStaffPatients;

test('staff patient helper API initializes', () => {
  assert.equal(typeof api.validateEdit, 'function');
  assert.equal(typeof api.escapeHTML, 'function');
  assert.equal(api.isClinicalStaff('doctor'), true);
  assert.equal(api.isClinicalStaff('nurse'), true);
  assert.equal(api.isClinicalStaff('other'), false);
  assert.equal(api.isClinicalStaff(''), false);
});

test('database migration uses text patient IDs and limits patient access to clinical Staff', () => {
  assert.match(migration, /staff_update_patient_record\(\s*p_patient_id text/i);
  assert.match(migration, /app_private\.is_clinical_staff\(\)/i);
  assert.match(migration, /account_type[^;]*in\s*\('doctor',\s*'nurse'\)/is);
  assert.match(migration, /create policy patients_select_owner_or_staff[\s\S]*app_private\.is_clinical_staff\(\)/i);
  assert.match(migration, /create policy patients_update_staff_admin[\s\S]*app_private\.is_active_patient_admin\(\)/i);
  assert.match(migration, /Only an active Doctor can update patient prescriptions/i);
  assert.match(updatePolicyMigration, /using \(app_private\.has_role\('admin'\)\)/i);
  assert.match(updatePolicyMigration, /with check \(app_private\.has_role\('admin'\)\)/i);
});

test('valid patient edits pass validation', () => {
  assert.equal(api.validateEdit({
    status: 'Green',
    birthDate: '',
    guardianNum: '09171234567',
    doctorNotes: 'Follow-up as scheduled'
  }), '');
});

test('unsupported health status is rejected', () => {
  assert.match(api.validateEdit({ status: 'Critical', birthDate: '' }), /valid patient health status/i);
});

test('future birth dates are rejected', () => {
  assert.match(api.validateEdit({ status: 'Yellow', birthDate: '2999-01-01' }), /future/i);
});

test('oversized guardian number and doctor notes are rejected', () => {
  assert.match(api.validateEdit({ status: 'Red', guardianNum: '1'.repeat(41) }), /too long/i);
  assert.match(api.validateEdit({ status: 'Red', doctorNotes: 'x'.repeat(4001) }), /4,000/i);
});

test('patient names and values are HTML escaped', () => {
  assert.equal(api.escapeHTML('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
});