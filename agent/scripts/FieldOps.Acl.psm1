Set-StrictMode -Version Latest

function Get-FieldOpsForbiddenLocalServiceRights {
    param([Parameter(Mandatory = $true)][bool]$IsDirectory)

    $forbiddenExecuteRights = if ($IsDirectory) {
        [Security.AccessControl.FileSystemRights]0
    } else {
        [Security.AccessControl.FileSystemRights]::ExecuteFile
    }

    return ([Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        $forbiddenExecuteRights -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership)
}

Export-ModuleMember -Function Get-FieldOpsForbiddenLocalServiceRights
