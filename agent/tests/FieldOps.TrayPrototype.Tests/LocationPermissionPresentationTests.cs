using FieldOps.TrayPrototype.Location;

namespace FieldOps.TrayPrototype.Tests;

public sealed class LocationPermissionPresentationTests
{
    [Fact]
    public async Task AllowedReportsGrantedDisablesMenuAndAttemptsAcquisition()
    {
        var api = new WindowsLocationBrokerTests.FakeLocationApi
        {
            Permission = WindowsLocationPermission.Allowed,
            Reading = Reading(),
        };

        var presentation = await ActAsync(api);

        Assert.Equal("Windows Location access granted.", presentation.Message);
        Assert.False(presentation.MenuEnabled);
        Assert.True(presentation.IsInformation);
        Assert.True(api.ReadCalled);
    }

    [Fact]
    public async Task DeniedReportsDeniedAndLeavesMenuEnabled()
    {
        var presentation = await ActAsync(new()
        {
            Permission = WindowsLocationPermission.Denied,
        });

        Assert.Equal("Windows Location access was denied.", presentation.Message);
        Assert.True(presentation.MenuEnabled);
        Assert.False(presentation.IsInformation);
    }

    [Fact]
    public async Task UnspecifiedDoesNotFabricateSuccess()
    {
        var presentation = await ActAsync(new()
        {
            Permission = WindowsLocationPermission.Unspecified,
        });

        Assert.Equal(
            "Windows could not determine the location permission state.",
            presentation.Message);
        Assert.True(presentation.MenuEnabled);
        Assert.DoesNotContain("granted", presentation.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DisabledReportsServicesDisabledAndLeavesMenuEnabled()
    {
        var presentation = await ActAsync(new()
        {
            Permission = WindowsLocationPermission.Allowed,
            Status = WindowsLocationPlatformStatus.Disabled,
        });

        Assert.Equal("Windows Location Services are disabled.", presentation.Message);
        Assert.True(presentation.MenuEnabled);
    }

    [Fact]
    public async Task ExceptionReportsConciseFailureAndLeavesMenuEnabled()
    {
        var presentation = await ActAsync(new()
        {
            Request = _ => throw new InvalidOperationException("sensitive stack detail"),
            GeolocatorCreated = false,
        });

        Assert.Equal("Windows Location permission request failed.", presentation.Message);
        Assert.True(presentation.MenuEnabled);
        Assert.DoesNotContain("sensitive", presentation.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task NotAvailableReportsActualPositionStatus()
    {
        var presentation = await ActAsync(new()
        {
            Permission = WindowsLocationPermission.Allowed,
            Status = WindowsLocationPlatformStatus.NotAvailable,
        });

        Assert.Equal(
            "Windows Location access granted.\nWindows reports PositionStatus.NotAvailable.",
            presentation.Message);
        Assert.False(presentation.MenuEnabled);
    }

    [Fact]
    public async Task InitializingReportsWaitingForFirstFix()
    {
        var presentation = await ActAsync(new()
        {
            Permission = WindowsLocationPermission.Allowed,
            Status = WindowsLocationPlatformStatus.Initializing,
        });

        Assert.Equal(
            "Windows Location access granted.\nWaiting for first GPS fix...",
            presentation.Message);
        Assert.False(presentation.MenuEnabled);
    }

    [Fact]
    public async Task DiagnosticsRecordBoundedPermissionFactsWithoutTelemetry()
    {
        var diagnostics = new RecordingDiagnostics();
        var api = new WindowsLocationBrokerTests.FakeLocationApi
        {
            Permission = WindowsLocationPermission.Allowed,
            Reading = Reading(),
        };
        var broker = new WindowsLocationBroker(api, diagnostics);

        await broker.RequestPermissionAsync(CancellationToken.None);

        Assert.True(diagnostics.Invoked);
        Assert.Equal(WindowsLocationPermission.Allowed, diagnostics.AccessStatus);
        Assert.Equal(WindowsLocationPlatformStatus.Ready, diagnostics.PositionStatus);
        Assert.True(diagnostics.GeolocatorCreated);
        Assert.False(diagnostics.Failed);
    }

    private static async Task<LocationPermissionPresentation> ActAsync(
        WindowsLocationBrokerTests.FakeLocationApi api)
    {
        var report = await new WindowsLocationBroker(api)
            .RequestPermissionAsync(CancellationToken.None);
        return LocationPermissionPresenter.Present(report);
    }

    private static WindowsLocationReading Reading() =>
        new(35, -80, null, 5, null, null, DateTimeOffset.UtcNow);

    private sealed class RecordingDiagnostics : IWindowsLocationDiagnostics
    {
        public bool Invoked { get; private set; }
        public WindowsLocationPermission? AccessStatus { get; private set; }
        public WindowsLocationPlatformStatus? PositionStatus { get; private set; }
        public bool GeolocatorCreated { get; private set; }
        public bool Failed { get; private set; }

        public void PermissionRequestInvoked() => Invoked = true;
        public void AccessStatusReturned(WindowsLocationPermission status) => AccessStatus = status;
        public void PositionStatusObserved(WindowsLocationPlatformStatus status) => PositionStatus = status;
        public void GeolocatorCreationObserved(bool created) => GeolocatorCreated = created;
        public void PermissionRequestFailed() => Failed = true;
    }
}
