      const API_ROOT = window.location.hostname
        ? `${window.location.protocol}//${window.location.hostname}:5050`
        : 'http://localhost:5050';
      let mode = 'login';
      const form = document.getElementById('auth-form');
      const nameField = document.getElementById('name-field');
      const nameInput = document.getElementById('name');
      const roleTrigger = document.getElementById('role-trigger');
      const roleMenu = document.getElementById('role-menu');
      let selectedRole = 'customer';
      const identifierInput = document.getElementById('identifier');
      const passwordInput = document.getElementById('password');
      const submitButton = document.getElementById('submit-button');
      const message = document.getElementById('message');
      const account = document.getElementById('account');
      const accountHeading = document.getElementById('account-heading');
      const heading = document.querySelector('.panel h2');
      const intro = document.getElementById('intro');
      const loginMode = document.getElementById('login-mode');
      const registerMode = document.getElementById('register-mode');
      const serviceStatus = document.getElementById('service-status');
      const forgotPassword = document.getElementById('forgot-password');
      const resetForm = document.getElementById('reset-form');
      const resetIntro = document.getElementById('reset-intro');
      const resetIdentifier = document.getElementById('reset-identifier');
      const resetIdentifierField = document.getElementById(
        'reset-identifier-field',
      );
      const resetTokenField = document.getElementById('reset-token-field');
      const resetToken = document.getElementById('reset-token');
      const codeStatusIndicator = document.getElementById('code-status-indicator');
      const codeStatusText = document.getElementById('code-status-text');
      const resendCodeBtn = document.getElementById('resend-code-btn');
      const passwordSliderBox = document.getElementById('password-slider-box');
      const newPasswordField = document.getElementById('new-password-field');
      const confirmPasswordField = document.getElementById(
        'confirm-password-field',
      );
      const newPassword = document.getElementById('new-password');
      const confirmPassword = document.getElementById('confirm-password');
      const resetSubmit = document.getElementById('reset-submit');
      const resetConfirmSubmit = document.getElementById('reset-confirm-submit');
      const cancelReset = document.getElementById('cancel-reset');

      fetch(`${API_ROOT}/health`)
        .then((response) => {
          if (!response.ok) throw new Error('offline');
          serviceStatus.textContent = 'Auth service online';
          serviceStatus.classList.add('online');
        })
        .catch(() => {
          serviceStatus.textContent = 'Auth service offline';
          serviceStatus.classList.add('offline');
        });

      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('auth') === 'expired') {
        message.textContent = 'Your session has expired. Please sign in again to continue.';
        message.className = 'message error';
      }

      function setMode(nextMode) {
        mode = nextMode;
        const isRegistering = mode === 'register';
        heading.textContent = isRegistering ? 'Create account' : 'Sign in';
        intro.textContent = isRegistering
          ? 'Create your Tomato account with an email or mobile number and password.'
          : 'Use your email or mobile number and password to access your Tomato account.';
        nameField.classList.toggle('hidden', !isRegistering);
        nameInput.required = isRegistering;
        passwordInput.autocomplete = isRegistering
          ? 'new-password'
          : 'current-password';
        submitButton.textContent = isRegistering ? 'Create account' : 'Sign in';
        message.textContent = isRegistering
          ? 'Ready to create your delivery account.'
          : 'Ready to sign you in.';
        message.className = 'message';
        account.classList.remove('visible');
        loginMode.classList.toggle('active', !isRegistering);
        registerMode.classList.toggle('active', isRegistering);
        loginMode.setAttribute('aria-selected', String(!isRegistering));
        registerMode.setAttribute('aria-selected', String(isRegistering));

        updateRoleFieldsVisibility();
      }

      function updateRoleFieldsVisibility() {
        const isRegistering = mode === 'register';
        const restRegFields = document.getElementById('restaurant-reg-fields');
        const riderRegFields = document.getElementById('rider-reg-fields');
        const addrLabel = document.querySelector('label[for="restaurant-address"]');
        const pinLabel = document.getElementById('restaurant-pincode-label');
        const digipinLabel = document.querySelector('label[for="restaurant-digipin"]');
        const restNote = document.getElementById('rest-helper-note');

        if (restRegFields) {
          restRegFields.classList.toggle('hidden', !(isRegistering && (selectedRole === 'restaurant' || selectedRole === 'shop')));
          if (selectedRole === 'shop') {
            if (addrLabel) addrLabel.textContent = 'Shop Address (Pickup Point)';
            if (pinLabel) pinLabel.innerHTML = 'Shop Pincode (Serviceable Area) <span style="color:var(--tomato);">*Required</span>';
            if (digipinLabel) digipinLabel.innerHTML = 'Shop Location / DIGIPIN <span style="color:var(--tomato);">*Required</span>';
            if (restNote) restNote.innerHTML = 'Used for order pickup by delivery riders. Each shop will receive a unique <strong>&lt;name&gt;/shopId</strong>.';
          } else {
            if (addrLabel) addrLabel.textContent = 'Restaurant Address (Pickup Point)';
            if (pinLabel) pinLabel.innerHTML = 'Restaurant Pincode (Serviceable Area) <span style="color:var(--tomato);">*Required</span>';
            if (digipinLabel) digipinLabel.innerHTML = 'Restaurant Location / DIGIPIN <span style="color:var(--tomato);">*Required</span>';
            if (restNote) restNote.innerHTML = 'Used for order pickup by delivery riders. Each restaurant will receive a unique <strong>&lt;name&gt;/restaurantId</strong>.';
          }
        }
        if (riderRegFields) {
          riderRegFields.classList.toggle('hidden', !(isRegistering && selectedRole === 'deliveryPartner'));
        }
      }

      function resolveRestaurantDigipin() {
        const status = document.getElementById('rest-gps-status');
        const latInput = document.getElementById('restaurant-lat');
        const lngInput = document.getElementById('restaurant-lng');
        const digipinInput = document.getElementById('restaurant-digipin');
        const dgpVal = (digipinInput?.value || '').trim().toUpperCase();

        if (!dgpVal) {
          if (status) status.textContent = 'Please enter a DigiPIN to resolve address location.';
          return;
        }

        // Decode DigiPIN (format DGP-lat-lng, pincode, or official grid)
        let coords = null;
        const dgpMatch = dgpVal.match(/DGP-(\d{3,4})-(\d{3,4})/i);
        if (dgpMatch && dgpMatch[1] && dgpMatch[2]) {
          coords = { lat: parseInt(dgpMatch[1], 10) / 100, lng: parseInt(dgpMatch[2], 10) / 100 };
        } else {
          const pinMatch = dgpVal.match(/\b\d{6}\b/);
          if (pinMatch) {
            const pin = pinMatch[0];
            if (pin === '411057') coords = { lat: 18.5707, lng: 73.6908 };
            else if (pin === '845401') coords = { lat: 26.6471, lng: 84.9085 };
            else if (pin === '560001') coords = { lat: 12.9716, lng: 77.5946 };
          }
        }

        if (!coords) {
          coords = { lat: 12.9716, lng: 77.5946 };
        }

        if (latInput) latInput.value = coords.lat.toFixed(5);
        if (lngInput) lngInput.value = coords.lng.toFixed(5);
        if (status) status.textContent = `📍 Location resolved from DigiPIN: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
      }
      function detectRestaurantGPS() {
        resolveRestaurantDigipin();
      }

      const DIGIPIN_CHARS_IDX = '23456789CFJKMPRT';
      function encodeIndiaPostDigipinLocal(lat, lng) {
        let minLat = 2.5, maxLat = 38.5;
        let minLng = 63.5, maxLng = 99.5;
        let code = '';
        for (let i = 0; i < 10; i++) {
          const latSpan = (maxLat - minLat) / 4;
          const lngSpan = (maxLng - minLng) / 4;
          let row = Math.floor((maxLat - lat) / latSpan);
          let col = Math.floor((lng - minLng) / lngSpan);
          if (row < 0) row = 0;
          if (row > 3) row = 3;
          if (col < 0) col = 0;
          if (col > 3) col = 3;
          const char = DIGIPIN_CHARS_IDX[row * 4 + col];
          if (char) code += char;
          maxLat = maxLat - row * latSpan;
          minLat = maxLat - latSpan;
          minLng = minLng + col * lngSpan;
          maxLng = minLng + lngSpan;
        }
        return `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6, 10)}`;
      }

      function setIndexDigipinFromCurrentDevice() {
        const digipinInput = document.getElementById('restaurant-digipin');
        const latInput = document.getElementById('restaurant-lat');
        const lngInput = document.getElementById('restaurant-lng');
        const status = document.getElementById('rest-gps-status');

        if (!navigator.geolocation) {
          if (status) status.textContent = 'Geolocation not supported by browser.';
          return;
        }
        if (status) status.textContent = 'Fetching current device spot...';

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const code = encodeIndiaPostDigipinLocal(lat, lng);
            if (digipinInput) digipinInput.value = code;
            if (latInput) latInput.value = lat.toFixed(5);
            if (lngInput) lngInput.value = lng.toFixed(5);
            if (status) status.textContent = `✓ DigiPIN set to ${code} from your current device spot!`;
          },
          (err) => {
            if (status) status.textContent = 'Unable to fetch spot. Please select from "Other Location".';
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }

      function openIndexDigipinPickerModal() {
        const modal = document.getElementById('index-digipin-picker-modal');
        if (modal) modal.style.display = 'grid';
      }

      function closeIndexDigipinPickerModal() {
        const modal = document.getElementById('index-digipin-picker-modal');
        if (modal) modal.style.display = 'none';
      }

      function applyIndexDigipinSelection(digipin, lat, lng) {
        const digipinInput = document.getElementById('restaurant-digipin');
        const latInput = document.getElementById('restaurant-lat');
        const lngInput = document.getElementById('restaurant-lng');
        const status = document.getElementById('rest-gps-status');

        if (digipinInput) digipinInput.value = digipin;
        if (latInput && typeof lat === 'number') latInput.value = lat.toFixed(5);
        if (lngInput && typeof lng === 'number') lngInput.value = lng.toFixed(5);
        if (status) status.textContent = `✓ DigiPIN set to ${digipin}`;
        closeIndexDigipinPickerModal();
      }

      function calculateIndexCustomDigipin() {
        const pinVal = (document.getElementById('index-modal-pincode')?.value || '').trim();
        const coordsVal = (document.getElementById('index-modal-coords')?.value || '').trim();
        let lat = null, lng = null;

        if (coordsVal) {
          const parts = coordsVal.split(',').map(s => Number(s.trim()));
          if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            lat = parts[0];
            lng = parts[1];
          }
        }
        if ((lat === null || lng === null) && pinVal) {
          if (pinVal === '411057') { lat = 18.5707; lng = 73.6908; }
          else if (pinVal === '845401') { lat = 26.6471; lng = 84.9085; }
          else if (pinVal === '560038') { lat = 12.9780; lng = 77.6408; }
          else { lat = 12.9716; lng = 77.5946; }
        }
        if (lat !== null && lng !== null) {
          const code = encodeIndiaPostDigipinLocal(lat, lng);
          applyIndexDigipinSelection(code, lat, lng);
        }
      }

      window.setIndexDigipinFromCurrentDevice = setIndexDigipinFromCurrentDevice;
      window.openIndexDigipinPickerModal = openIndexDigipinPickerModal;
      window.closeIndexDigipinPickerModal = closeIndexDigipinPickerModal;
      window.applyIndexDigipinSelection = applyIndexDigipinSelection;
      window.calculateIndexCustomDigipin = calculateIndexCustomDigipin;

      loginMode.addEventListener('click', () => setMode('login'));
      registerMode.addEventListener('click', () => setMode('register'));

      roleTrigger.addEventListener('click', () => {
        const isOpen = roleMenu.classList.toggle('visible');
        roleTrigger.setAttribute('aria-expanded', String(isOpen));
      });

      document.querySelectorAll('.role-option').forEach((option) =>
        option.addEventListener('click', () => {
          selectedRole = option.dataset.role;
          roleMenu.classList.remove('visible');
          roleTrigger.setAttribute('aria-expanded', 'false');
          message.textContent = `${option.dataset.label} account selected.`;
          message.className = 'message';

          updateRoleFieldsVisibility();
        }),
      );

      document.addEventListener('click', (event) => {
        if (!event.target.closest('.name-control')) {
          roleMenu.classList.remove('visible');
          roleTrigger.setAttribute('aria-expanded', 'false');
        }
      });

      forgotPassword.addEventListener('click', () => {
        form.classList.add('hidden');
        forgotPassword.classList.add('hidden');
        account.classList.remove('visible');
        resetForm.classList.remove('hidden');
        message.textContent = 'Enter your account identifier to begin.';
        message.className = 'message';
        resetIdentifier.focus();
      });

      let resendTimer = null;
      let resendCountdown = 30;

      function clearResetState() {
        if (resendTimer) {
          clearInterval(resendTimer);
          resendTimer = null;
        }
        resendCountdown = 30;
        if (resendCodeBtn) {
          resendCodeBtn.disabled = false;
          resendCodeBtn.textContent = 'Resend code?';
        }
        resetToken.value = '';
        resetToken.classList.remove('is-valid', 'is-invalid');
        codeStatusIndicator.className = 'code-status-indicator';
        codeStatusIndicator.textContent = '';
        codeStatusText.className = 'code-status-text';
        codeStatusText.textContent = '';
        passwordSliderBox.classList.remove('expanded');
        newPassword.value = '';
        confirmPassword.value = '';
        resetToken.required = false;
        newPassword.required = false;
        confirmPassword.required = false;
        resetSubmit.textContent = 'Send verification code';
        resetSubmit.classList.remove('hidden');
        resetSubmit.disabled = false;
        resetConfirmSubmit.textContent = 'Reset password';
        resetConfirmSubmit.disabled = false;
      }

      function startResendCooldown() {
        if (resendTimer) clearInterval(resendTimer);
        resendCountdown = 30;
        resendCodeBtn.disabled = true;
        resendCodeBtn.textContent = `Resend code in ${resendCountdown}s`;
        resendTimer = setInterval(() => {
          resendCountdown -= 1;
          if (resendCountdown <= 0) {
            clearInterval(resendTimer);
            resendTimer = null;
            resendCodeBtn.disabled = false;
            resendCodeBtn.textContent = 'Resend code?';
          } else {
            resendCodeBtn.textContent = `Resend code in ${resendCountdown}s`;
          }
        }, 1000);
      }

      cancelReset.addEventListener('click', () => {
        resetForm.classList.add('hidden');
        form.classList.remove('hidden');
        forgotPassword.classList.remove('hidden');
        resetIdentifierField.classList.remove('hidden');
        resetTokenField.classList.add('hidden');
        clearResetState();
        resetIntro.textContent =
          'Enter your email or mobile number to receive a 6-digit verification code.';
        message.textContent = 'Ready to sign you in.';
        message.className = 'message';
      });

      // Dynamic validation of 6-digit verification code as user types
      let verifyDebounce = null;
      resetToken.addEventListener('input', () => {
        const cleaned = resetToken.value.replace(/\D/g, '').slice(0, 6);
        resetToken.value = cleaned;

        if (cleaned.length < 6) {
          resetToken.classList.remove('is-valid', 'is-invalid');
          codeStatusIndicator.className = 'code-status-indicator';
          codeStatusIndicator.textContent = '';
          codeStatusText.className = 'code-status-text';
          codeStatusText.textContent = '';
          passwordSliderBox.classList.remove('expanded');
          newPassword.required = false;
          confirmPassword.required = false;
          return;
        }

        // When 6 digits entered, verify dynamically
        if (verifyDebounce) clearTimeout(verifyDebounce);
        verifyDebounce = setTimeout(async () => {
          codeStatusIndicator.className = 'code-status-indicator checking';
          codeStatusIndicator.textContent = '';
          codeStatusText.className = 'code-status-text';
          codeStatusText.textContent = 'Verifying code...';

          try {
            const response = await fetch(
              `${API_ROOT}/api/auth/password-reset/verify-code`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetToken: cleaned }),
              },
            );
            const data = await response.json().catch(() => ({}));

            if (response.ok && data.valid) {
              // Valid: Green tick mark & slide down new password box
              resetToken.classList.remove('is-invalid');
              resetToken.classList.add('is-valid');
              codeStatusIndicator.className = 'code-status-indicator valid';
              codeStatusIndicator.textContent = '✓';
              codeStatusText.className = 'code-status-text valid';
              codeStatusText.textContent = '✓ Code confirmed! Please provide your new password below.';
              
              // Slide down the new box
              passwordSliderBox.classList.add('expanded');
              newPassword.required = true;
              confirmPassword.required = true;
              setTimeout(() => {
                newPassword.focus();
              }, 250);
            } else {
              // Invalid: Red cross mark & stay on same page
              resetToken.classList.remove('is-valid');
              resetToken.classList.add('is-invalid');
              codeStatusIndicator.className = 'code-status-indicator invalid';
              codeStatusIndicator.textContent = '✕';
              codeStatusText.className = 'code-status-text invalid';
              codeStatusText.textContent = data.message || '✕ Invalid or expired verification code.';
              passwordSliderBox.classList.remove('expanded');
              newPassword.required = false;
              confirmPassword.required = false;
            }
          } catch (err) {
            resetToken.classList.remove('is-valid');
            resetToken.classList.add('is-invalid');
            codeStatusIndicator.className = 'code-status-indicator invalid';
            codeStatusIndicator.textContent = '✕';
            codeStatusText.className = 'code-status-text invalid';
            codeStatusText.textContent = 'Unable to verify code. Please check your connection.';
            passwordSliderBox.classList.remove('expanded');
          }
        }, 150);
      });

      // Prevent Enter key in resetToken from submitting or re-requesting
      resetToken.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (passwordSliderBox.classList.contains('expanded')) {
            newPassword.focus();
          }
        }
      });

      // Dynamic resend verification code handler (ONLY explicit user click sends code again)
      resendCodeBtn.addEventListener('click', async () => {
        if (resendCodeBtn.disabled) return;
        resendCodeBtn.disabled = true;
        const prevText = resendCodeBtn.textContent;
        resendCodeBtn.textContent = 'Sending...';
        message.textContent = '';
        message.className = 'message';

        try {
          const response = await fetch(
            `${API_ROOT}/api/auth/password-reset/request`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                identifier: resetIdentifier.value.trim(),
                isResend: true,
              }),
            },
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.message || 'Unable to resend verification code.');
          }

          resetToken.value = '';
          resetToken.classList.remove('is-valid', 'is-invalid');
          codeStatusIndicator.className = 'code-status-indicator';
          codeStatusIndicator.textContent = '';
          codeStatusText.className = 'code-status-text';
          codeStatusText.textContent = '';
          passwordSliderBox.classList.remove('expanded');

          message.textContent = data.message || 'A fresh 6-digit verification code has been sent to your email!';
          message.className = 'message success';
          startResendCooldown();
          resetToken.focus();
        } catch (error) {
          resendCodeBtn.disabled = false;
          resendCodeBtn.textContent = prevText;
          message.textContent = error.message;
          message.className = 'message error';
        }
      });

      // Submit handler for initial code request & form submission
      let isRequestingCode = false;
      resetForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (resetTokenField.classList.contains('hidden')) {
          if (isRequestingCode) return;
          isRequestingCode = true;
          resetSubmit.disabled = true;
          resetSubmit.textContent = 'Sending code...';
          message.textContent = '';
          message.className = 'message';

          try {
            const response = await fetch(
              `${API_ROOT}/api/auth/password-reset/request`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  identifier: resetIdentifier.value.trim(),
                  isResend: false,
                }),
              },
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(data.message || 'Unable to start password reset.');
            }

            resetIdentifierField.classList.add('hidden');
            resetSubmit.classList.add('hidden');
            resetTokenField.classList.remove('hidden');
            resetToken.value = '';
            resetToken.required = true;
            resetIntro.textContent = data.maskedEmail
              ? `Enter the 6-digit verification code sent to ${data.maskedEmail}.`
              : 'Enter the 6-digit verification code sent to your registered email.';
            message.textContent = data.message || '6-digit verification code sent to your email. Valid for 10 minutes.';
            message.className = 'message success';
            startResendCooldown();
            resetToken.focus();
          } catch (error) {
            message.textContent =
              error instanceof TypeError
                ? 'The auth service is unavailable. Start it on port 5050.'
                : error.message;
            message.className = 'message error';
          } finally {
            isRequestingCode = false;
            resetSubmit.disabled = false;
            resetSubmit.textContent = 'Send verification code';
          }
          return;
        }

        if (passwordSliderBox.classList.contains('expanded')) {
          performPasswordReset();
        }
      });

      // Submit new password
      resetConfirmSubmit.addEventListener('click', () => {
        performPasswordReset();
      });

      async function performPasswordReset() {
        const trimmedToken = resetToken.value.trim();
        if (trimmedToken.length !== 6 || !/^\d{6}$/.test(trimmedToken)) {
          message.textContent = 'Please enter the valid 6-digit verification code sent to your email.';
          message.className = 'message error';
          resetToken.focus();
          return;
        }

        if (!newPassword.value || newPassword.value.length < 8) {
          message.textContent = 'Password must be at least 8 characters long.';
          message.className = 'message error';
          newPassword.focus();
          return;
        }

        if (newPassword.value !== confirmPassword.value) {
          message.textContent = 'The new passwords do not match.';
          message.className = 'message error';
          confirmPassword.focus();
          return;
        }

        resetConfirmSubmit.disabled = true;
        resetConfirmSubmit.textContent = 'Saving...';
        message.textContent = '';
        message.className = 'message';

        try {
          const response = await fetch(
            `${API_ROOT}/api/auth/password-reset/confirm`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                resetToken: trimmedToken,
                password: newPassword.value,
              }),
            },
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.message || 'Unable to reset password.');
          }

          cancelReset.click();
          message.textContent =
            'Password reset successful. You can sign in now with your new password.';
          message.className = 'message success';
        } catch (error) {
          message.textContent =
            error instanceof TypeError
              ? 'The auth service is unavailable. Start it on port 5050.'
              : error.message;
          message.className = 'message error';
        } finally {
          resetConfirmSubmit.disabled = false;
          resetConfirmSubmit.textContent = 'Reset password';
        }
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        message.textContent = '';
        message.className = 'message';
        account.classList.remove('visible');
        submitButton.disabled = true;
        submitButton.textContent =
          mode === 'register' ? 'Creating...' : 'Checking...';

        try {
          const rawId = identifierInput.value.trim();
          const isEmail = rawId.includes('@');
          const payload = {
            name: nameInput.value.trim(),
            identifier: rawId,
            ...(isEmail
              ? { email: rawId }
              : { phone: rawId }),
            password: passwordInput.value,
            role: mode === 'register' ? selectedRole : undefined,
          };

          if (mode === 'register') {
            if (selectedRole === 'restaurant' || selectedRole === 'shop') {
              const addr = document.getElementById('restaurant-address')?.value?.trim() || '';
              const pin = document.getElementById('restaurant-pincode')?.value?.trim() || '';
              if (selectedRole === 'shop') {
                payload.shopAddress = addr;
              } else {
                payload.restaurantAddress = addr;
              }
              if (pin) payload.pincode = pin;
              payload.digipin = document.getElementById('restaurant-digipin')?.value?.trim() || '';
              const latVal = document.getElementById('restaurant-lat')?.value;
              const lngVal = document.getElementById('restaurant-lng')?.value;
              if (latVal && lngVal && !isNaN(Number(latVal))) {
                payload.lat = Number(latVal);
                payload.lng = Number(lngVal);
              } else if (!payload.digipin) {
                payload.lat = 12.9716;
                payload.lng = 77.5946;
                payload.digipin = 'DGP-1297-7759';
              }
            } else if (selectedRole === 'deliveryPartner') {
              payload.deliveryVehicle = document.getElementById('rider-vehicle')?.value?.trim() || 'motorcycle';
              payload.lat = 12.9721;
              payload.lng = 77.5952;
            }
          }

          const response = await fetch(`${API_ROOT}/api/auth/${mode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          });
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.message || 'Unable to sign in.');
          }

          if (mode === 'register' && data.user?.role === 'employee' && data.user?.isApproved === false) {
            if (window.TomatoSecurity && window.TomatoSecurity.clearClientSession) {
              window.TomatoSecurity.clearClientSession();
            } else {
              localStorage.removeItem('tomatoToken');
              localStorage.removeItem('tomatoUser');
            }
            accountHeading.textContent = 'Registration Received';
            document.getElementById('account-name').textContent = data.user.displayName || data.user.name;
            document.getElementById('account-email').textContent = data.user.email || 'Not provided';
            document.getElementById('account-phone').textContent = data.user.phone || 'Not provided';
            document.getElementById('account-role').textContent = 'Employee (Pending Approval)';
            account.classList.add('visible');
            message.textContent = 'Your employee registration has been submitted and is pending administrator approval and role assignment. You will be able to sign in once approved.';
            message.className = 'message success';
            submitButton.disabled = false;
            submitButton.textContent = 'Create account';
            return;
          }

          localStorage.setItem('tomatoToken', data.token);
          if (data.user) {
            delete data.user.walletBalance;
            delete data.user.creditPoint;
          }
          localStorage.setItem('tomatoUser', JSON.stringify(data.user));
          try {
            sessionStorage.removeItem('tomato_active_view');
          } catch (_) {}
          document.getElementById('account-name').textContent = data.user.displayName || data.user.name;
          document.getElementById('account-email').textContent =
            data.user.email || 'Not provided';
          document.getElementById('account-phone').textContent =
            data.user.phone || 'Not provided';
          document.getElementById('account-role').textContent =
            data.user.role || 'user';
          accountHeading.textContent =
            mode === 'register' ? 'Your account is ready' : 'Welcome back';
          account.classList.add('visible');
          message.textContent =
            mode === 'register'
              ? 'Registration successful.'
              : 'Login successful.';
          message.className = 'message success';
          window.setTimeout(() => {
            window.location.href = 'dashboard/loginDashboard.html';
          }, 450);
        } catch (error) {
          message.textContent =
            error instanceof TypeError
              ? 'The auth service is unavailable. Start it on port 5050.'
              : error.message;
          message.className = 'message error';
        } finally {
          submitButton.disabled = false;
          submitButton.textContent =
            mode === 'register' ? 'Create account' : 'Sign in';
        }
      });

      // Automatically handle password reset if user arrives via email link
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlResetToken = urlParams.get('token') || urlParams.get('resetToken');
        if (urlResetToken && forgotPassword && resetToken) {
          forgotPassword.click();
          resetToken.value = urlResetToken;
          resetIdentifierField.classList.add('hidden');
          resetSubmit.classList.add('hidden');
          resetTokenField.classList.remove('hidden');
          resetToken.required = true;
          // Trigger dynamic verification input event
          resetToken.dispatchEvent(new Event('input'));
          message.textContent = 'Verification code applied from email link.';
          message.className = 'message success';
          if (window.TomatoSecurity && window.TomatoSecurity.scrubSensitiveUrlParams) {
            window.TomatoSecurity.scrubSensitiveUrlParams();
          }
        }
      } catch (_) {}
