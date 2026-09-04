Set-StrictMode -Version Latest

function Get-FieldOpsAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][bool]$IsDirectory
    )

    if ($IsDirectory) {
        return [IO.Directory]::GetAccessControl($Path)
    }
    return [IO.File]::GetAccessControl($Path)
}

function Set-FieldOpsAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][Security.AccessControl.FileSystemSecurity]$Acl,
        [Parameter(Mandatory = $true)][bool]$IsDirectory
    )

    if ($IsDirectory) {
        [IO.Directory]::SetAccessControl($Path, [Security.AccessControl.DirectorySecurity]$Acl)
        return
    }
    [IO.File]::SetAccessControl($Path, [Security.AccessControl.FileSecurity]$Acl)
}

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

Export-ModuleMember -Function Get-FieldOpsAcl, Set-FieldOpsAcl, Get-FieldOpsForbiddenLocalServiceRights
