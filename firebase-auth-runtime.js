window.epStore = window.epStore || window.localStorage;
var epStore = window.epStore;
/* ERecPass Standalone Firebase Authentication & Local Data Layer */
(function () {
  'use strict';

  console.info('[ERecPass] Initializing Firebase Auth & Standalone Storage layer...');

  // Preserve the browser client initialized by supabase-client.js.

  const KEYS = window.DB_KEYS || {
    PATIENTS: 'erecpass_db_patients',
    STAFF: 'erecpass_db_staff',
    ADMIN_ACCOUNTS: 'erecpass_db_admin_accounts',
    ANNOUNCEMENTS: 'erecpass_db_announcements',
    APPOINTMENTS: 'erecpass_db_appointments',
    CHATS: 'erecpass_db_chats',
    LOGS: 'erecpass_db_logs',
    SESSION: 'erecpass_db_session',
    AGREEMENT: 'erecpass_db_agreement',
    EMERGENCY_NUMS: 'erecpass_db_emergencynums',
    APP_SETTINGS: 'erecpass_db_app_settings'
  };

  const store = window.epStore || window.localStorage;

  function getLocal(k, fallback) {
    try {
      const val = store.getItem(k);
      return val ? JSON.parse(val) : fallback;
    } catch (_) { return fallback; }
  }

  function setLocal(k, val) {
    try {
      store.setItem(k, typeof val === 'string' ? val : JSON.stringify(val));
    } catch (e) { console.warn('[ERecPass] Store write warning:', e); }
  }

  async function ensureTrustedDevice(email) {
    if (typeof window.isErecpassDeviceTrusted !== 'function' ||
        typeof window.triggerNewDeviceConfirmation !== 'function') {
      throw new Error('Email login confirmation is unavailable. Refresh the page and try again.');
    }
    if (window.isErecpassDeviceTrusted(email)) return true;
    await window.triggerNewDeviceConfirmation({ email: email });
    return false;
  }

  function calculateAge(birthDate) {
    const match = String(birthDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const birth = new Date(year, month - 1, day);
    const today = new Date();
    const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day || birth > now) return null;
    let age = now.getFullYear() - year;
    if (now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day)) age--;
    return age;
  }

  function todayString() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  window.previewRegisterBirthDate = function () {
    const input = document.getElementById('regBirthDate');
    const preview = document.getElementById('regBirthDatePreview');
    if (!input || !preview) return;
    if (!input.value) { preview.textContent = 'Your age will be calculated from your date of birth.'; return; }
    const age = calculateAge(input.value);
    preview.textContent = age === null ? 'Please enter a valid date that is not in the future.' : `Calculated age: ${age} · ${age <= 17 ? 'Minor' : 'Adult'}`;
  };

  function limitBirthDateInput() {
    const input = document.getElementById('regBirthDate');
    if (input) input.max = todayString();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', limitBirthDateInput);
  else limitBirthDateInput();

  function seedDefaults() {
    const admins = getLocal(KEYS.ADMIN_ACCOUNTS, []);
    if (!admins.some(a => String(a.email || a.username || '').toLowerCase() === 'admin2@gmail.com')) {
      admins.push({ id: 'A-1', name: 'System Admin', username: 'admin2@gmail.com', email: 'admin2@gmail.com', password: 'admin', active: true });
      setLocal(KEYS.ADMIN_ACCOUNTS, admins);
    }
    const staff = getLocal(KEYS.STAFF, []);
    if (!staff.length) {
      staff.push({ id: 'S-1', name: 'Dr. Jane Smith', email: 'staff@gmail.com', password: 'staff', role: 'Doctor', role_title: 'Doctor', task: 'General Medicine', available: true, active: true });
      setLocal(KEYS.STAFF, staff);
    }
    if (!store.getItem(KEYS.AGREEMENT)) {
      setLocal(KEYS.AGREEMENT, { text: 'Welcome to ERecPass. Please keep your account secure and use this portal only for authorized hospital services.', photo: '' });
    }
    if (!store.getItem(KEYS.EMERGENCY_NUMS)) {
      setLocal(KEYS.EMERGENCY_NUMS, { barangay: '0917-123-4567', national: '911' });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', seedDefaults);
  } else {
    seedDefaults();
  }

  // ==========================================
  // 1. PATIENT REGISTRATION
  // ==========================================
  window.handleRegister = async function (e) {
    if (e) e.preventDefault();

    const firstName = (document.getElementById('regFirstName')?.value || '').trim();
    const lastName = (document.getElementById('regLastName')?.value || '').trim();
    const noMiddle = !!document.getElementById('regNoMiddleName')?.checked;
    const middleRaw = (document.getElementById('regMiddleName')?.value || '').trim();
    const middleName = (noMiddle || /^n\/?a$/i.test(middleRaw)) ? '' : middleRaw;
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
    const email    = (document.getElementById('regEmail')?.value || '').trim().toLowerCase();
    const sim      = (document.getElementById('regSim')?.value || '').trim();
    const birthDate = (document.getElementById('regBirthDate')?.value || '').trim();
    const age = calculateAge(birthDate);
    const pass     = document.getElementById('regPassword')?.value || '';
    const confirm  = document.getElementById('regConfirmPassword')?.value || '';

    if (!firstName || !lastName) { alert('Please enter your First Name and Last Name.'); return; }
    if (!noMiddle && !middleName) { alert('Please enter your Middle Name, or check N/A if you do not have one.'); return; }
    if (!fullName || !email || !sim || !birthDate || !pass) { alert('Please complete all required fields, including your date of birth.'); return; }
    if (age === null) { alert('Please enter a valid date of birth that is not in the future.'); return; }
    if (pass !== confirm)  { alert('Passwords do not match!'); return; }
    if (pass.length < 8)   { alert('Password must contain at least 8 characters.'); return; }
    if (!/[#!?]/.test(pass)) { alert('Password must contain at least one symbol: # ! ?'); return; }

    const submit = document.querySelector('#registerForm button[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = 'CREATING ACCOUNT…'; }

    try {
      if (!window.ERecPassFirebase || !window.ERecPassFirebase.isConfigured()) {
        throw new Error('Firebase email verification is unavailable. Refresh the page and try again.');
      }
      await window.ERecPassFirebase.registerAndSendConfirmation(email, pass, fullName);

      // 2. Save patient locally
      const patients = getLocal(KEYS.PATIENTS, []);
      let patient = patients.find(p => String(p.email || '').toLowerCase() === email);
      if (!patient) {
        patient = {
          id: 'P-' + Date.now(),
          fullName, name: fullName, email, sim,
          guardianNum: sim, birthDate, birth_date: birthDate, age,
          ageCategory: age <= 17 ? 'Minor' : 'Adult', status: 'Green',
          active: true, online: false, labResults: [], prescriptions: [], doctorNotes: ''
        };
        patients.push(patient);
      } else {
        patient.fullName = fullName;
        patient.name = fullName;
        patient.sim = sim;
        patient.birthDate = birthDate;
        patient.birth_date = birthDate;
        patient.age = age;
        patient.ageCategory = age <= 17 ? 'Minor' : 'Adult';
      }
      setLocal(KEYS.PATIENTS, patients);

      // 3. Reset form
      document.getElementById('registerForm')?.reset();

      // 4. Show the styled Gmail confirmation popup
      if (typeof window.showFirebaseConfirmModal === 'function') {
        window.showFirebaseConfirmModal(email, pass);
      } else {
        if (typeof window.showLogin === 'function') window.showLogin();
        alert('Registration successful! Check your Gmail for the confirmation link.');
      }

    } catch (err) {
      console.error('[ERecPass] Registration error:', err);
      alert('Could not create account: ' + (err?.message || err));
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = 'CREATE ACCOUNT'; }
    }
  };

  // ==========================================
  // 2. FIRST VERIFIED LOGIN: create Supabase account and patient row
  // ==========================================
  async function createOrLoadSupabasePatient(email, password, fullName, sim, birthDate, allowCreate) {
    const client = window.erecpassSupabase;
    if (!client?.auth) throw new Error('Supabase is not connected. Refresh the app and try again.');

    let authData = null;
    let signup = null;
    if (allowCreate) {
      signup = await client.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, role: 'patient', sim } }
      });
      if (signup.error) {
        const message = String(signup.error.message || '').toLowerCase();
        if (!/already registered|already been registered|user already exists|already exists/.test(message)) throw signup.error;
      } else if (signup.data?.session) {
        authData = signup.data;
      }
    }

    // Firebase is the verification provider. Supabase confirmation must be off
    // so the first verified login can establish its Supabase session.
    if (!authData?.session) {
      const login = await client.auth.signInWithPassword({ email, password });
      if (login.error) {
        const loginMessage = String(login.error.message || '').toLowerCase();
        if (allowCreate && !signup?.error && signup?.data?.user &&
            (loginMessage.includes('email not confirmed') || loginMessage.includes('email_not_confirmed'))) {
          throw new Error('Firebase verified this email, but Supabase is requesting another confirmation. Disable Supabase email confirmation; Firebase handles verification.');
        }
        throw login.error;
      }
      authData = login.data;
    }

    const user = authData?.user;
    if (!user?.id) throw new Error('Supabase did not return a signed-in account.');

    const profileResult = await client.from('profiles')
      .select('id,full_name,role,active').eq('id', user.id).maybeSingle();
    if (profileResult.error) throw profileResult.error;
    let profile = profileResult.data;
    if (!profile) {
      if (!allowCreate) throw new Error('This older account has no Supabase profile. Contact the administrator to link it.');
      const write = await client.from('profiles').upsert({
        id: user.id, full_name: fullName, role: 'patient', active: true
      }, { onConflict: 'id' });
      if (write.error) throw write.error;
      profile = { id: user.id, full_name: fullName, role: 'patient', active: true };
    }
    if (String(profile.role || '').toLowerCase() !== 'patient') throw new Error('This Supabase account is not assigned the patient role.');
    if (profile.active === false) throw new Error('This patient account is deactivated. Login is disabled.');

    const existing = await client.from('patients').select('*').eq('user_id', user.id).maybeSingle();
    if (existing.error) throw existing.error;
    const values = {
      id: existing.data?.id || user.id,
      user_id: user.id,
      full_name: fullName,
      email: user.email || email,
      sim: sim || existing.data?.sim || null,
      birth_date: existing.data?.birth_date || birthDate || null,
      age: existing.data?.age ?? calculateAge(existing.data?.birth_date || birthDate),
      age_category: existing.data?.age_category || (calculateAge(existing.data?.birth_date || birthDate) === null ? 'Adult' : (calculateAge(existing.data?.birth_date || birthDate) <= 17 ? 'Minor' : 'Adult')),
      status: existing.data?.status || 'Green',
      active: existing.data?.active !== false
    };
    let patient = existing.data;
    if (!patient) {
      if (!allowCreate) throw new Error('This older account has no Supabase patient record. Contact the administrator to link it.');
      const saved = await client.from('patients').insert(values).select('*').single();
      if (saved.error) throw saved.error;
      patient = saved.data;
    } else if (birthDate && !existing.data.birth_date) {
      const age = calculateAge(birthDate);
      const updated = await client.from('patients').update({
        birth_date: birthDate,
        age,
        age_category: age <= 17 ? 'Minor' : 'Adult'
      }).eq('user_id', user.id).select('*').single();
      if (updated.error) throw updated.error;
      patient = updated.data;
    }
    if (!patient?.id || patient.user_id !== user.id) throw new Error('Supabase did not confirm the patient record.');
    return { user, patient };
  }

  window.handleLogin = async function (e) {
    if (e) e.preventDefault();
    const email = (document.getElementById('loginEmail')?.value || '').trim().toLowerCase();
    const pass = document.getElementById('loginPassword')?.value || '';
    if (!email || !pass) { alert('Please enter your email and password.'); return; }

    try {
      if (!window.ERecPassFirebase || !window.ERecPassFirebase.isConfigured()) {
        throw new Error('Firebase email verification is unavailable. Refresh the page and try again.');
      }
      const check = await window.ERecPassFirebase.checkEmailVerification(email, pass);
      if (check.error) { alert(check.error); return; }
      if (check.verified === false) {
        const resend = await window.erecpassConfirm('Your email has not been verified yet. Click the verification link in your inbox first. Resend the email?');
        if (resend) {
          try { await window.ERecPassFirebase.resendVerificationEmail(email, pass); alert('Verification email resent to ' + email + '.'); }
          catch (err) { alert('Could not resend: ' + (err?.message || err)); }
        }
        return;
      }

      if (!await ensureTrustedDevice(email)) return;

      const patients = getLocal(KEYS.PATIENTS, []);
      const local = patients.find(p => String(p.email || '').toLowerCase() === email);
      const fullName = String(local?.fullName || local?.name || check.displayName || email.split('@')[0])
        .trim().split(/\s+/).filter(Boolean).join(' ');
      const result = await createOrLoadSupabasePatient(email, pass, fullName, local?.sim || local?.guardianNum || '', local?.birthDate || local?.birth_date || '', !check.legacy);
      const patient = Object.assign({}, local || {}, result.patient, {
        id: result.patient.id,
        user_id: result.user.id,
        fullName: result.patient.full_name || fullName,
        name: result.patient.full_name || fullName,
        email: result.user.email || email,
        birthDate: result.patient.birth_date || local?.birthDate || local?.birth_date || '',
        birth_date: result.patient.birth_date || local?.birthDate || local?.birth_date || '',
        age: result.patient.age ?? calculateAge(result.patient.birth_date || local?.birthDate || local?.birth_date),
        online: true
      });
      if (patient.active === false) {
        await window.erecpassSupabase.auth.signOut();
        throw new Error('This patient account is deactivated. Login is disabled.');
      }
      const index = patients.findIndex(p => String(p.user_id || '') === result.user.id || String(p.email || '').toLowerCase() === email);
      if (index >= 0) patients[index] = patient; else patients.push(patient);
      setLocal(KEYS.PATIENTS, patients);
      const patientSession = { role: 'patient', data: patient };
      window.currentSession = patientSession;
      try { currentSession = patientSession; } catch (_) {}
      setLocal(KEYS.SESSION, patientSession);
      if (typeof window.addLog === 'function') window.addLog('Patient logged in: ' + fullName);
      if (typeof window.hideAuthPages === 'function') window.hideAuthPages();
      if (typeof window.launchPortalByRole === 'function') window.launchPortalByRole('patient');
    } catch (err) {
      console.error('[ERecPass] Login error:', err);
      alert('Login failed: ' + (err?.message || err));
    }
  };

  // ==========================================
  // 3. STAFF LOGIN
  // ==========================================
  window.handleStaffLogin = async function (e) {
    if (e) e.preventDefault();

    const email = (document.getElementById('staffLoginName')?.value || '').trim().toLowerCase();
    const pass  = document.getElementById('staffLoginPassword')?.value || '';

    if (!email || !pass) { alert('Please enter your staff email and password.'); return; }

    const staffList = getLocal(KEYS.STAFF, []);
    const staff = staffList.find(s =>
      (String(s.email || '').toLowerCase() === email || String(s.name || '').toLowerCase() === email) &&
      (s.password ? s.password === pass : true)
    );

    if (!staff) { alert('Invalid Staff email or password.'); return; }
    if (staff.active === false) { alert('This staff account is deactivated.'); return; }

    const staffEmail = String(staff.email || '').trim().toLowerCase();
    if (!staffEmail || !staffEmail.includes('@')) {
      alert('This staff account does not have a valid email address for login confirmation. Contact the administrator.');
      return;
    }

    try {
      if (!await ensureTrustedDevice(staffEmail)) return;
    } catch (err) {
      console.error('[ERecPass] Staff device confirmation error:', err);
      alert('Staff login could not be confirmed: ' + (err?.message || err));
      return;
    }

    const staffSession = { role: 'staff', data: staff };
    window.currentSession = staffSession;
    try { currentSession = staffSession; } catch (_) {}
    setLocal(KEYS.SESSION, staffSession);

    if (typeof window.addLog === 'function') window.addLog('Staff logged in: ' + (staff.name || email));
    if (typeof window.hideAuthPages === 'function') window.hideAuthPages();
    if (typeof window.launchPortalByRole === 'function') window.launchPortalByRole('staff');
  };

  // ==========================================
  // 4. ADMIN LOGIN
  // ==========================================
  window.handleAdminLogin = async function (e) {
    if (e) e.preventDefault();

    const email = (document.getElementById('adminLoginUser')?.value || '').trim().toLowerCase();
    const pass = document.getElementById('adminLoginPassword')?.value || '';

    if (!email || !pass) { alert('Please enter admin email and password.'); return; }
    const client = window.erecpassSupabase;
    if (!client?.auth) { alert('Supabase is not connected. Refresh the app and try again.'); return; }

    try {
      const signedIn = await client.auth.signInWithPassword({ email, password: pass });
      if (signedIn.error) throw signedIn.error;
      const user = signedIn.data?.user;
      if (!user?.id) throw new Error('Supabase did not return an Admin account.');
      const profileResult = await client.from('profiles')
        .select('id,full_name,role,active').eq('id', user.id).maybeSingle();
      if (profileResult.error) throw profileResult.error;
      const profile = profileResult.data;
      if (!profile || String(profile.role || '').toLowerCase() !== 'admin' || profile.active === false) {
        await client.auth.signOut();
        throw new Error(profile?.active === false ? 'This Admin account is deactivated.' : 'This account is not enabled for Admin Login.');
      }

      const adminSession = { role: 'admin', data: {
        id: user.id,
        name: profile.full_name || email,
        username: email,
        email: user.email || email
      } };
      window.currentSession = adminSession;
      try { currentSession = adminSession; } catch (_) {}
      setLocal(KEYS.SESSION, adminSession);
      // Load all cloud-backed records before revealing the Admin portal.
      // supabase-runtime.js installs this hydrator and its epStore adapter.
      if (typeof window.erecpassCloudHydrate === 'function') await window.erecpassCloudHydrate();
      if (typeof window.addLog === 'function') window.addLog('Admin logged in: ' + email);
      if (typeof window.hideAuthPages === 'function') window.hideAuthPages();
      if (typeof window.launchPortalByRole === 'function') window.launchPortalByRole('admin');
      if (typeof window.renderAdminAnnouncementList === 'function') window.renderAdminAnnouncementList();
    } catch (err) {
      console.error('[ERecPass] Admin login error:', err);
      alert('Admin login failed: ' + (err?.message || err));
    }
  };

  // ==========================================
  // 5. APPOINTMENT ACTIONS
  // ==========================================
  window.updateApptStatus = async function (id, status) {
    if (!id || !['Approved', 'Cancelled'].includes(status)) return;
    if (status === 'Cancelled' && !await window.erecpassConfirm('Cancel this appointment?\nYou cannot undo this action.')) return;

    try {
      const appts = getLocal(KEYS.APPOINTMENTS, []);
      const appt = appts.find(a => String(a.id || a.legacy_id) === String(id));
      if (appt) { appt.status = status; setLocal(KEYS.APPOINTMENTS, appts); }
      if (typeof window.renderAdminAppointmentsList === 'function') await window.renderAdminAppointmentsList();
      if (typeof window.renderAppointments === 'function') window.renderAppointments();
      alert('Appointment status updated to: ' + status);
    } catch (err) {
      alert('Could not update appointment: ' + (err?.message || err));
    }
  };

  window.deleteErecpassAppointment = async function (id) {
    if (!id) return;
    try {
      const appts = getLocal(KEYS.APPOINTMENTS, []);
      setLocal(KEYS.APPOINTMENTS, appts.filter(a => String(a.id || a.legacy_id) !== String(id)));
      if (typeof window.renderAdminAppointmentsList === 'function') await window.renderAdminAppointmentsList();
      if (typeof window.renderAppointments === 'function') window.renderAppointments();
      alert('Appointment deleted successfully.');
      return true;
    } catch (err) {
      alert('Could not delete appointment: ' + (err?.message || err));
    }
  };

  // ==========================================
  // 6. LOGOUT
  // ==========================================
  window.logout = function () {
    try {
      if (window.ERecPassFirebase && window.ERecPassFirebase.getAuth()) {
        window.ERecPassFirebase.getAuth().signOut();
      }
    } catch (_) {}

    window.currentSession = null;
    try { currentSession = null; } catch (_) {}
    store.removeItem(KEYS.SESSION);

    ['patientApp', 'staffApp', 'adminApp'].forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });

    if (typeof window.showLogin === 'function') window.showLogin();
  };

  const DEVICE_EMAIL_KEY = 'erecpass_pending_device_email';

  window.isErecpassDeviceTrusted = function (email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    return !!normalizedEmail && window.localStorage.getItem('erecpass_trusted_device:' + normalizedEmail) === '1';
  };

  window.markErecpassDeviceAsTrusted = function (email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('A valid email address is required to trust this device.');
    window.localStorage.setItem('erecpass_trusted_device:' + normalizedEmail, '1');
  };

  window.triggerNewDeviceConfirmation = async function (request) {
    const email = String(request?.email || '').trim().toLowerCase();
    if (!email) throw new Error('A valid email address is required for login confirmation.');
    if (!window.ERecPassFirebase || !window.ERecPassFirebase.isConfigured()) {
      throw new Error('Email login confirmation is unavailable. Please try again later.');
    }
    window.localStorage.setItem(DEVICE_EMAIL_KEY, email);
    try {
      await window.ERecPassFirebase.sendNewDeviceConfirmationEmail(email, window.location.origin + window.location.pathname);
    } catch (err) {
      window.localStorage.removeItem(DEVICE_EMAIL_KEY);
      throw err;
    }
    alert('We sent a sign-in confirmation link to ' + email + '. Open the link on this same phone and browser. After confirmation, return here and sign in again.');
  };

  async function completeNewDeviceConfirmation() {
    const auth = window.ERecPassFirebase?.getAuth();
    if (!auth || !auth.isSignInWithEmailLink(window.location.href)) return;

    const pendingEmail = window.localStorage.getItem(DEVICE_EMAIL_KEY) || '';
    const email = (pendingEmail || window.prompt('Enter the email address that received this sign-in link:') || '')
      .trim().toLowerCase();
    if (!email) throw new Error('The email address is required to finish sign-in confirmation.');

    try {
      const credential = await auth.signInWithEmailLink(email, window.location.href);
      const signedInEmail = String(credential.user?.email || '').trim().toLowerCase();
      if (signedInEmail !== email) {
        throw new Error('The confirmation link belongs to a different email address.');
      }

      window.markErecpassDeviceAsTrusted(email);
      window.localStorage.removeItem(DEVICE_EMAIL_KEY);
      window.history.replaceState(null, document.title, window.location.pathname);
      alert('This phone is confirmed. Return to the login screen and sign in again.');
    } finally {
      if (auth.currentUser) await auth.signOut();
    }
  }

  window.addEventListener('load', function () {
    completeNewDeviceConfirmation().catch(function (err) {
      console.error('[ERecPass] Device confirmation error:', err);
      alert('Could not confirm this device: ' + (err?.message || err));
    });
  }, { once: true });

  console.info('[ERecPass] Firebase Auth runtime ready.');
})();
