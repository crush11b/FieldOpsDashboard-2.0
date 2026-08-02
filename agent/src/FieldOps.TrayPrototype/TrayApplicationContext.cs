using System.Diagnostics;
using System.Drawing;
using System.ServiceProcess;
using System.Windows.Forms;

namespace FieldOps.TrayPrototype;

internal sealed class TrayApplicationContext(
    TrayRefreshCoordinator refreshCoordinator,
    IRestartCoordinator restartCoordinator) : ApplicationContext
{
    private readonly CancellationTokenSource lifetimeCancellation = new();
    private readonly ToolStripMenuItem statusItem = new("Status: checking...") { Enabled = false };
    private readonly ToolStripMenuItem healthItem = new("Health: checking...") { Enabled = false };
    private readonly ToolStripMenuItem restartItem = new("Restart FieldOps Agent");
    private readonly System.Windows.Forms.Timer refreshTimer = new() { Interval = 5000 };
    private readonly NotifyIcon notifyIcon = new()
    {
        Icon = SystemIcons.Application,
        Text = "FieldOps Dashboard",
        Visible = false,
    };
    private bool started;
    private bool shutdownStarted;

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
        var dashboardItem = new ToolStripMenuItem("Open Dashboard");
        dashboardItem.Click += (_, _) => OpenDashboard();
        var exitItem = new ToolStripMenuItem("Exit");
        exitItem.Click += (_, _) => ExitThread();

        notifyIcon.ContextMenuStrip = new ContextMenuStrip();
        notifyIcon.ContextMenuStrip.Items.AddRange([
            dashboardItem,
            statusItem,
            healthItem,
            new ToolStripSeparator(),
            refreshItem,
            restartItem,
            new ToolStripSeparator(),
            exitItem,
        ]);

        notifyIcon.Visible = true;
        refreshTimer.Start();
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
        notifyIcon.Visible = false;
        notifyIcon.ContextMenuStrip?.Dispose();
        notifyIcon.Dispose();
        lifetimeCancellation.Dispose();
    }

    private static void OpenDashboard()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "http://localhost:3000",
            UseShellExecute = true,
        });
    }
}
