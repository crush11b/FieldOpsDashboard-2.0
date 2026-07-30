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
    private readonly NotifyIcon notifyIcon = new()
    {
        Icon = SystemIcons.Application,
        Text = "FieldOps Dashboard",
        Visible = true,
    };

    public void Start()
    {
        restartItem.Click += async (_, _) => await RestartAsync();
        var refreshItem = new ToolStripMenuItem("Refresh");
        refreshItem.Click += async (_, _) => await RefreshAsync();
        var exitItem = new ToolStripMenuItem("Exit");
        exitItem.Click += (_, _) => ExitThread();

        notifyIcon.ContextMenuStrip = new ContextMenuStrip();
        notifyIcon.ContextMenuStrip.Items.AddRange([
            statusItem,
            healthItem,
            new ToolStripSeparator(),
            refreshItem,
            restartItem,
            new ToolStripSeparator(),
            exitItem,
        ]);

        _ = RefreshAsync();
    }

    protected override void ExitThreadCore()
    {
        lifetimeCancellation.Cancel();
        refreshCoordinator.Dispose();
        lifetimeCancellation.Dispose();
        notifyIcon.Visible = false;
        notifyIcon.Dispose();
        base.ExitThreadCore();
    }

    private async Task RefreshAsync()
    {
        var result = await refreshCoordinator.RefreshAsync(lifetimeCancellation.Token);
        if (result is null)
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
        MessageBox.Show(
            result.Detail,
            result.Succeeded ? "FieldOps Agent restarted" : "FieldOps Agent restart failed",
            MessageBoxButtons.OK,
            result.Succeeded ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        await RefreshAsync();
    }
}
