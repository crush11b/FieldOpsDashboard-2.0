using System.Diagnostics;
using System.Drawing;
using System.ServiceProcess;
using System.Windows.Forms;
using FieldOps.TrayPrototype.Launcher;
using FieldOps.TrayPrototype.Location;

namespace FieldOps.TrayPrototype;

internal sealed class TrayApplicationContext(
    TrayRefreshCoordinator refreshCoordinator,
    IRestartCoordinator restartCoordinator,
    WindowsLocationBroker locationBroker,
    LocationBrokerPipeServer locationPipeServer,
    LauncherPipeServer launcherPipeServer,
    IDashboardBackendLifecycle dashboardBackend,
    IDashboardBrowser dashboardBrowser) : ApplicationContext
{
    private readonly DashboardOpenCoordinator dashboardOpenCoordinator = new(dashboardBackend, dashboardBrowser);
    private readonly CancellationTokenSource lifetimeCancellation = new();
    private readonly ToolStripMenuItem statusItem = new("Status: checking...") { Enabled = false };
    private readonly ToolStripMenuItem healthItem = new("Health: checking...") { Enabled = false };
    private readonly ToolStripMenuItem dashboardStatusItem = new("Dashboard: starting...") { Enabled = false };
    private readonly ToolStripMenuItem restartItem = new("Restart FieldOps Agent");
    private readonly ToolStripMenuItem enableLocationItem = new("Enable Windows Location");
    private readonly System.Windows.Forms.Timer refreshTimer = new() { Interval = 5000 };
    private readonly NotifyIcon notifyIcon = new()
    {
        Icon = SystemIcons.Application,
        Text = "FieldOps Dashboard",
        Visible = false,
    };
    private bool started;
    private bool shutdownStarted;
    private bool locationPermissionRequestInProgress;

    public void Start()
    {
        if (started)
        {
            throw new InvalidOperationException("The tray application context has already started.");
        }

        started = true;
        refreshTimer.Tick += async (_, _) => await RefreshAsync();
        restartItem.Click += async (_, _) =>
        {
            if (!shutdownStarted)
            {
                await RestartAsync();
            }
        };
        var refreshItem = new ToolStripMenuItem("Refresh");
        refreshItem.Click += async (_, _) =>
        {
            if (!shutdownStarted)
            {
                await RefreshAsync();
            }
        };
        enableLocationItem.Click += async (_, _) =>
        {
            if (!shutdownStarted)
            {
                await RequestLocationPermissionAsync();
            }
        };
        var dashboardItem = new ToolStripMenuItem("Open Dashboard");
        dashboardItem.Click += async (_, _) => await OpenDashboardAsync();
        var exitItem = new ToolStripMenuItem("Exit");
        exitItem.Click += (_, _) => ExitThread();

        notifyIcon.ContextMenuStrip = new ContextMenuStrip();
        notifyIcon.ContextMenuStrip.Items.AddRange([
            dashboardItem,
            dashboardStatusItem,
            statusItem,
            healthItem,
            new ToolStripSeparator(),
            refreshItem,
            restartItem,
            enableLocationItem,
            new ToolStripSeparator(),
            exitItem,
        ]);

        notifyIcon.Visible = true;
        refreshTimer.Start();
        _ = locationPipeServer.RunAsync(lifetimeCancellation.Token);
        _ = launcherPipeServer.RunAsync(lifetimeCancellation.Token);
        _ = EnsureDashboardAsync();
        _ = RefreshAsync();
    }

    protected override void ExitThreadCore()
    {
        Shutdown();
        base.ExitThreadCore();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Shutdown();
        }

        base.Dispose(disposing);
    }

    private async Task RefreshAsync()
    {
        var result = await refreshCoordinator.RefreshAsync(lifetimeCancellation.Token);
        if (result is null)
        {
            return;
        }

        if (shutdownStarted)
        {
            return;
        }

        statusItem.Text = result.ServiceText;
        healthItem.Text = result.HealthText;
        restartItem.Enabled = result.RestartEnabled;
        notifyIcon.Text = result.ToolTipText;
    }

    private async Task RestartAsync()
    {
        restartItem.Enabled = false;
        var result = await restartCoordinator.RestartAsync(lifetimeCancellation.Token);
        if (shutdownStarted)
        {
            return;
        }

        MessageBox.Show(
            result.Detail,
            result.Succeeded ? "FieldOps Agent restarted" : "FieldOps Agent restart failed",
            MessageBoxButtons.OK,
            result.Succeeded ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        // The restart helper verifies authenticated health through the same native
        // endpoint, but the service may still be replacing its pipe instance. Poll
        // through the shared tray health client after the restart settles so stale
        // Access Denied state cannot remain visible.
        await Task.Delay(TimeSpan.FromMilliseconds(250), lifetimeCancellation.Token);
        await RefreshAsync();
    }

    private async Task RequestLocationPermissionAsync()
    {
        if (locationPermissionRequestInProgress)
        {
            return;
        }

        locationPermissionRequestInProgress = true;
        try
        {
            var report = await locationBroker.RequestPermissionAsync(lifetimeCancellation.Token);
            if (shutdownStarted)
            {
                return;
            }

            var presentation = LocationPermissionPresenter.Present(report);
            enableLocationItem.Enabled = presentation.MenuEnabled;
            MessageBox.Show(
                presentation.Message,
                presentation.Caption,
                MessageBoxButtons.OK,
                presentation.IsInformation ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        finally
        {
            locationPermissionRequestInProgress = false;
        }
    }

    private void Shutdown()
    {
        if (shutdownStarted)
        {
            return;
        }

        shutdownStarted = true;
        lifetimeCancellation.Cancel();
        refreshTimer.Stop();
        refreshTimer.Dispose();
        refreshCoordinator.Dispose();
        dashboardBackend.DisposeAsync().AsTask().GetAwaiter().GetResult();
        notifyIcon.Visible = false;
        notifyIcon.ContextMenuStrip?.Dispose();
        notifyIcon.Dispose();
        lifetimeCancellation.Dispose();
    }

    private async Task EnsureDashboardAsync()
    {
        try
        {
            var result = await dashboardBackend.EnsureReadyAsync(lifetimeCancellation.Token);
            if (!shutdownStarted)
            {
                dashboardStatusItem.Text = $"Dashboard: {result.State} ({result.Detail})";
            }
        }
        catch (OperationCanceledException) when (shutdownStarted)
        {
        }
        catch (Exception exception)
        {
            dashboardStatusItem.Text = $"Dashboard: Unavailable ({exception.Message})";
        }
    }

    private async Task OpenDashboardAsync()
    {
        try
        {
            var result = await dashboardOpenCoordinator.OpenAsync(lifetimeCancellation.Token);
            if (shutdownStarted)
            {
                return;
            }

            dashboardStatusItem.Text = $"Dashboard: {result.State} ({result.Detail})";
            if (result.State == DashboardBackendState.Ready) return;

            MessageBox.Show(
                result.Detail,
                "FieldOps Dashboard unavailable",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
        catch (OperationCanceledException) when (shutdownStarted)
        {
        }
        catch (Exception exception)
        {
            dashboardStatusItem.Text = $"Dashboard: Unavailable ({exception.Message})";
            MessageBox.Show(
                exception.Message,
                "FieldOps Dashboard unavailable",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }
}
