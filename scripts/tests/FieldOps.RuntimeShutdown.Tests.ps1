$modulePath = Join-Path $PSScriptRoot '..\FieldOps.RuntimeShutdown.psm1'
Import-Module $modulePath -Force

Describe 'FieldOps runtime shutdown' {
    BeforeEach {
            $global:FieldOpsTestServiceExists = $true
            $global:FieldOpsTestServiceStatus = 'Running'
            $global:FieldOpsTestProcesses = @()
            $global:FieldOpsTestStoppedIds = @()

            Mock Get-Service -ModuleName FieldOps.RuntimeShutdown {
                if ($global:FieldOpsTestServiceExists) {
                    [pscustomobject]@{ Name = $Name; Status = $global:FieldOpsTestServiceStatus }
                }
            }
            Mock Stop-Service -ModuleName FieldOps.RuntimeShutdown { $global:FieldOpsTestServiceStatus = 'Stopped' }
            Mock Stop-Process -ModuleName FieldOps.RuntimeShutdown {
                param($Id)
                $global:FieldOpsTestStoppedIds = @($global:FieldOpsTestStoppedIds) + @($Id)
            }
            Mock Get-CimInstance -ModuleName FieldOps.RuntimeShutdown {
                @($global:FieldOpsTestProcesses | Where-Object { $global:FieldOpsTestStoppedIds -notcontains $_.ProcessId })
            }
            Mock Start-Sleep -ModuleName FieldOps.RuntimeShutdown {}
        }

    AfterEach {
            Remove-Variable FieldOpsTestServiceExists, FieldOpsTestServiceStatus, FieldOpsTestProcesses, FieldOpsTestStoppedIds -Scope Global -ErrorAction SilentlyContinue
        }

    It 'stops a running FieldOpsAgent service and verifies quiescence' {
            $result = Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -Timeout ([TimeSpan]::FromSeconds(1))

            $result.Status | Should Be 'quiescent'
            Assert-MockCalled Stop-Service -ModuleName FieldOps.RuntimeShutdown -Times 1 -Scope It -ParameterFilter { $Name -eq 'FieldOpsAgent' }
            Assert-MockCalled Stop-Process -ModuleName FieldOps.RuntimeShutdown -Times 0 -Scope It
        }

    It 'accepts an already stopped FieldOpsAgent service' {
            $global:FieldOpsTestServiceStatus = 'Stopped'

            $result = Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -Timeout ([TimeSpan]::FromSeconds(1))

            $result.Status | Should Be 'quiescent'
            Assert-MockCalled Stop-Service -ModuleName FieldOps.RuntimeShutdown -Times 0 -Scope It
        }

    It 'aborts when the service cannot reach Stopped' {
            Mock Stop-Service -ModuleName FieldOps.RuntimeShutdown {}

            { Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -Timeout ([TimeSpan]::Zero) } |
                Should Throw 'did not reach Stopped'
            Assert-MockCalled Stop-Service -ModuleName FieldOps.RuntimeShutdown -Times 1 -Scope It
        }

    It 'detects and terminates the FieldOps Agent process by exact path' {
            $global:FieldOpsTestServiceStatus = 'Stopped'
            $global:FieldOpsTestProcesses = @([pscustomobject]@{
                Name = 'FieldOps.Agent.exe'; ProcessId = 101; ExecutablePath = 'C:\Program Files\FieldOpsDashboard\Agent\FieldOps.Agent.exe'; CommandLine = 'FieldOps.Agent.exe'
            })

            Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -Timeout ([TimeSpan]::FromSeconds(1))

            Assert-MockCalled Stop-Process -ModuleName FieldOps.RuntimeShutdown -Times 1 -Scope It -ParameterFilter { $Id -eq 101 }
        }

    It 'detects and terminates the FieldOps Tray process by exact path' {
            $global:FieldOpsTestServiceStatus = 'Stopped'
            $global:FieldOpsTestProcesses = @([pscustomobject]@{
                Name = 'FieldOps.Tray.exe'; ProcessId = 102; ExecutablePath = 'C:\Program Files\FieldOpsDashboard\Tray\FieldOps.Tray.exe'; CommandLine = 'FieldOps.Tray.exe'
            })

            Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -Timeout ([TimeSpan]::FromSeconds(1))

            Assert-MockCalled Stop-Process -ModuleName FieldOps.RuntimeShutdown -Times 1 -Scope It -ParameterFilter { $Id -eq 102 }
        }

    It 'stops owned dashboard Node and cmd wrapper processes but preserves unrelated Node' {
            $global:FieldOpsTestServiceStatus = 'Stopped'
            $global:FieldOpsTestProcesses = @(
                [pscustomobject]@{ Name = 'node.exe'; ProcessId = 201; ExecutablePath = 'C:\Program Files\nodejs\node.exe'; CommandLine = 'node C:\FieldOpsDashboard\dist\server.cjs' },
                [pscustomobject]@{ Name = 'cmd.exe'; ProcessId = 202; ExecutablePath = 'C:\Windows\System32\cmd.exe'; CommandLine = 'cmd /c cd /d C:\FieldOpsDashboard && npm start' },
                [pscustomobject]@{ Name = 'node.exe'; ProcessId = 203; ExecutablePath = 'C:\Program Files\nodejs\node.exe'; CommandLine = 'node C:\OtherApplication\server.cjs' },
                [pscustomobject]@{ Name = 'node.exe'; ProcessId = 204; ExecutablePath = 'C:\Program Files\nodejs\node.exe'; CommandLine = 'node C:\FieldOpsDashboard2\dist\server.cjs' }
            )

            Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -Timeout ([TimeSpan]::FromSeconds(1))

            Assert-MockCalled Stop-Process -ModuleName FieldOps.RuntimeShutdown -Times 2 -Scope It
            ($global:FieldOpsTestStoppedIds -contains 203) | Should Be $false
            ($global:FieldOpsTestStoppedIds -contains 204) | Should Be $false
        }

    It 'fails with remaining process details when quiescence misses its deadline' {
            $global:FieldOpsTestServiceStatus = 'Stopped'
            $global:FieldOpsTestProcesses = @([pscustomobject]@{
                Name = 'FieldOps.Tray.exe'; ProcessId = 303; ExecutablePath = 'C:\Program Files\FieldOpsDashboard\Tray\FieldOps.Tray.exe'; CommandLine = 'FieldOps.Tray.exe'
            })
            Mock Stop-Process -ModuleName FieldOps.RuntimeShutdown {}

            { Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -Timeout ([TimeSpan]::Zero) } |
                Should Throw 'FieldOps.Tray.exe PID 303'
        }

    It 'succeeds when no FieldOps runtime is running' {
            $global:FieldOpsTestServiceExists = $false

            $result = Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -Timeout ([TimeSpan]::FromSeconds(1))

            $result.Status | Should Be 'quiescent'
            Assert-MockCalled Stop-Service -ModuleName FieldOps.RuntimeShutdown -Times 0 -Scope It
            Assert-MockCalled Stop-Process -ModuleName FieldOps.RuntimeShutdown -Times 0 -Scope It
        }

    It 'preserves SkipProcessStop as an explicit shutdown and gate bypass' {
            $result = Invoke-FieldOpsRuntimeShutdown -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -SkipProcessStop

            $result.Status | Should Be 'skipped'
            Assert-MockCalled Get-Service -ModuleName FieldOps.RuntimeShutdown -Times 0 -Scope It
            Assert-MockCalled Get-CimInstance -ModuleName FieldOps.RuntimeShutdown -Times 0 -Scope It
            Assert-MockCalled Stop-Service -ModuleName FieldOps.RuntimeShutdown -Times 0 -Scope It
            Assert-MockCalled Stop-Process -ModuleName FieldOps.RuntimeShutdown -Times 0 -Scope It
    }
}
