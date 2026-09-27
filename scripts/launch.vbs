Option Explicit
Dim shell, files, repo, nodePath
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
repo = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
nodePath = "node"
If WScript.Arguments.Count > 0 Then nodePath = WScript.Arguments(0)
shell.CurrentDirectory = repo
shell.Run """" & nodePath & """ """ & repo & "\scripts\launch.mjs""", 0, False
