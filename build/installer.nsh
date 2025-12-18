!macro customInstall
  ; Copy all files from resources\build into the installation directory (beside the EXE)
  SetOutPath "$INSTDIR"
  ; Use xcopy for recursive copy. $SYSDIR typically contains xcopy.exe
  ; ExecWait syntax: ExecWait command_line [user_var]
  ExecWait '"$SYSDIR\\xcopy.exe" "$INSTDIR\\resources\\build\\*" "$INSTDIR\\" /E /I /Y' $0
!macroend

!macro customUnInstall
  ; Remove the copied build folder on uninstall
  RMDir /r "$INSTDIR\\build"
!macroend
