; Synced NSIS Installer Hooks
; Checks and installs prerequisites before the main application installation.
;
; Prerequisites handled:
;   1. WebView2 Runtime — handled automatically by Tauri's embedBootstrapper
;   2. Visual C++ Redistributable 2015-2022 (x64) — checked and installed here
;
; The VC++ Redistributable is required by the PyInstaller-bundled Python sidecar.
; If not present, the sidecar will fail to start with missing DLL errors.

!include LogicLib.nsh
!include WinMessages.nsh

; ── Helpers ──────────────────────────────────────────────────────────────────

; Check if VC++ Redistributable 2015-2022 (x64) is installed by reading the
; registry key written by every official VC++ redist installer.
; Sets $0 = 1 if installed, $0 = 0 otherwise.
!macro _CheckVCRedist
    StrCpy $0 0
    ; Primary detection: Microsoft's "Installed" DWORD value
    ReadRegDWORD $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
    ${If} $1 == 1
        StrCpy $0 1
    ${EndIf}

    ; Fallback: check for the core DLL directly (covers edge cases where
    ; registry was cleaned but DLLs remain from a Windows update)
    ${If} $0 == 0
        IfFileExists "$SYSDIR\vcruntime140.dll" 0 +2
            StrCpy $0 1
    ${EndIf}
!macroend

; ── Pre-Install Hook ────────────────────────────────────────────────────────

!macro NSIS_HOOK_PREINSTALL
    ; --- Check Visual C++ Redistributable ---
    !insertmacro _CheckVCRedist
    ${If} $0 == 0
        ; VC++ Redist not found — ask the user
        MessageBox MB_YESNO|MB_ICONQUESTION \
            "Synced requires the Microsoft Visual C++ Redistributable (2015-2022).$\n$\n\
            It does not appear to be installed on this system.$\n$\n\
            Would you like to download and install it now?$\n$\n\
            (An internet connection is required)" \
            IDYES _vcredist_install IDNO _vcredist_skip

    _vcredist_install:
        ; Download the latest VC++ Redistributable x64 installer
        DetailPrint "Downloading Visual C++ Redistributable..."
        NSISdl::download \
            "https://aka.ms/vs/17/release/vc_redist.x64.exe" \
            "$TEMP\vc_redist.x64.exe"
        Pop $2  ; download status
        ${If} $2 != "success"
            ; Download failed — try the direct Microsoft CDN URL as fallback
            DetailPrint "Primary download failed ($2), trying fallback URL..."
            NSISdl::download \
                "https://download.visualstudio.microsoft.com/download/pr/vcredist_x64.exe" \
                "$TEMP\vc_redist.x64.exe"
            Pop $2
            ${If} $2 != "success"
                MessageBox MB_OK|MB_ICONEXCLAMATION \
                    "Failed to download Visual C++ Redistributable ($2).$\n$\n\
                    You can install it manually from:$\n\
                    https://aka.ms/vs/17/release/vc_redist.x64.exe$\n$\n\
                    The application may not work correctly without it."
                Goto _vcredist_done
            ${EndIf}
        ${EndIf}

        ; Run the installer silently with progress bar
        DetailPrint "Installing Visual C++ Redistributable..."
        ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart' $3
        ${If} $3 == 0
            DetailPrint "Visual C++ Redistributable installed successfully."
        ${ElseIf} $3 == 1638
            ; 1638 = already installed (race condition with another installer)
            DetailPrint "Visual C++ Redistributable is already installed."
        ${ElseIf} $3 == 3010
            ; 3010 = success, reboot required
            DetailPrint "Visual C++ Redistributable installed (reboot may be required)."
        ${Else}
            MessageBox MB_OK|MB_ICONEXCLAMATION \
                "Visual C++ Redistributable installation returned code $3.$\n$\n\
                If the application doesn't start, try installing it manually from:$\n\
                https://aka.ms/vs/17/release/vc_redist.x64.exe"
        ${EndIf}

        ; Clean up the downloaded installer
        Delete "$TEMP\vc_redist.x64.exe"

    _vcredist_skip:
    _vcredist_done:
    ${EndIf}
!macroend

; ── Post-Install Hook ───────────────────────────────────────────────────────

!macro NSIS_HOOK_POSTINSTALL
    ; Add Windows Firewall exception for the sidecar so peers on the LAN
    ; can connect without a firewall prompt blocking the first launch.
    DetailPrint "Adding firewall exception for Synced..."

    ; Allow inbound TCP on the sidecar port (signaling WebSocket)
    nsExec::ExecToLog 'netsh advfirewall firewall add rule \
        name="Synced Server" \
        dir=in \
        action=allow \
        program="$INSTDIR\binaries\synced-server.exe" \
        enable=yes \
        profile=private,public \
        protocol=tcp \
        description="Allow Synced peer-to-peer signaling connections"'

    ; Allow inbound UDP (WebRTC ICE candidates on local network)
    nsExec::ExecToLog 'netsh advfirewall firewall add rule \
        name="Synced Server (UDP)" \
        dir=in \
        action=allow \
        program="$INSTDIR\binaries\synced-server.exe" \
        enable=yes \
        profile=private,public \
        protocol=udp \
        description="Allow Synced WebRTC peer connections"'
!macroend

; ── Pre-Uninstall Hook ──────────────────────────────────────────────────────

!macro NSIS_HOOK_PREUNINSTALL
    ; Remove firewall rules added during install
    DetailPrint "Removing firewall exceptions..."
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Synced Server"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Synced Server (UDP)"'
!macroend

; ── Post-Uninstall Hook ─────────────────────────────────────────────────────

!macro NSIS_HOOK_POSTUNINSTALL
    ; Nothing extra needed — Tauri handles registry cleanup and file removal
!macroend
