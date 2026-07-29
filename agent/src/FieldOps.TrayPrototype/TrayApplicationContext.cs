using System.Drawing;
using System.ServiceProcess;
using System.Windows.Forms;

namespace FieldOps.TrayPrototype;

internal sealed class TrayApplicationContext(
    IServiceStatusReader serviceStatus,
    IAgentHealthClient healthClient,
    IRestartCoordinator restartCoordinator) : ApplicationContext
{
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
        notifyIcon.Visible = false;
        notifyIcon.Dispose();
        base.ExitThreadCore();
    }

    private async Task RefreshAsync()
    {
        var status = serviceStatus.Read();
        statusItem.Text = status.Status is null ? "Service: not installed" : $"Service: {status.Status}";
        restartItem.Enabled = status.Status is not (ServiceControllerStatus.StartPending
            or ServiceControllerStatus.StopPending);

        var health = await healthClient.ReadAsync(CancellationToken.None);
        healthItem.Text = $"Health: {health.State}";
        notifyIcon.Text = $"FieldOps Agent: {status.Status?.ToString() ?? "not installed"}; {health.State}";
    }

    private async Task RestartAsync()
    {
        restartItem.Enabled = false;
        var result = await restartCoordinator.RestartAsync(CancellationToken.None);
        MessageBox.Show(
            result.Detail,
            result.Succeeded ? "FieldOps Agent restarted" : "FieldOps Agent restart failed",
            MessageBoxButtons.OK,
            result.Succeeded ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        await RefreshAsync();
    }
}
