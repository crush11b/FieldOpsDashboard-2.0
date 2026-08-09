namespace FieldOps.TrayPrototype.Location;

internal sealed record LocationPermissionPresentation(
    string Message,
    string Caption,
    bool MenuEnabled,
    bool IsInformation);

internal static class LocationPermissionPresenter
{
    public static LocationPermissionPresentation Present(WindowsLocationPermissionReport report)
    {
        if (report.RequestFailed)
        {
            return new(
                "Windows Location permission request failed.",
                "Windows location unavailable",
                MenuEnabled: true,
                IsInformation: false);
        }

        if (report.PositionStatus == WindowsLocationPlatformStatus.Disabled)
        {
            return new(
                "Windows Location Services are disabled.",
                "Windows location disabled",
                MenuEnabled: true,
                IsInformation: false);
        }

        if (report.Permission == WindowsLocationPermission.Denied)
        {
            return new(
                "Windows Location access was denied.",
                "Windows location denied",
                MenuEnabled: true,
                IsInformation: false);
        }

        if (report.Permission != WindowsLocationPermission.Allowed)
        {
            return new(
                "Windows could not determine the location permission state.",
                "Windows location unavailable",
                MenuEnabled: true,
                IsInformation: false);
        }

        var detail = report.AcquisitionStatus switch
        {
            WindowsLocationAcquisitionStatus.Available => string.Empty,
            _ when report.PositionStatus == WindowsLocationPlatformStatus.Initializing =>
                "\nWaiting for first GPS fix...",
            _ => $"\nWindows reports PositionStatus.{report.PositionStatus}.",
        };
        return new(
            "Windows Location access granted." + detail,
            "Windows location access granted",
            MenuEnabled: false,
            IsInformation: true);
    }
}
