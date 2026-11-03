const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'staff-patient-management.js'), 'utf8');
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