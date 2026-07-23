Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & WshShell.CurrentDirectory & "\start.bat" & chr(34), 0
Set WshShell = Nothing
