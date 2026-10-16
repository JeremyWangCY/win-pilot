using System.Security.Principal;
using System.Text;

namespace WinPilotTaskDesktop;

class LoginSettingsDialog : Form
{
    readonly TextBox account=new(){Name="windows_account",Dock=DockStyle.Fill,MaxLength=512};
    readonly TextBox password=new(){Name="windows_password",Dock=DockStyle.Fill,UseSystemPasswordChar=true,MaxLength=512};
    readonly Label result=new(){Name="login_result",AutoSize=true,MaximumSize=new(490,0)};
    readonly CheckBox remember=new(){Name="remember_login",Text="在本机记住登录，后续自动连接",AutoSize=true,Checked=true};
    readonly WindowsLoginStore store;
    readonly Button save=new(){Text="验证并保存",AutoSize=true};
    bool busy,cancelled;
    internal WindowsLogin? Login { get; private set; }
    internal LoginSettingsDialog(WindowsLoginStore? loginStore=null,Func<WindowsLogin,Task>? validateLogin=null)
    {
        store=loginStore??new WindowsLoginStore();
        validateLogin??=value=>Task.Run(value.ValidateCurrentUser);
        Text="Win-Pilot · 独立桌面登录设置";ClientSize=new(540,330);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;StartPosition=FormStartPosition.CenterParent;Font=new Font("Microsoft YaHei UI",9);
        using var current=WindowsIdentity.GetCurrent();account.Text=current.Name;
        var layout=new TableLayoutPanel(){Dock=DockStyle.Fill,Padding=new Padding(22),ColumnCount=1,RowCount=9,AutoScroll=true};
        layout.Controls.Add(new Label(){Text="首次设置 Windows 登录信息",AutoSize=true,Font=new Font(Font.FontFamily,12,FontStyle.Bold)});
        layout.Controls.Add(new Label(){Text="请填写当前 Windows 用户的密码（不是 PIN）。勾选记住后，\nWin-Pilot 会使用 Windows 加密保存，后续自动取回登录。",AutoSize=true,Padding=new Padding(0,8,0,12)});
        layout.Controls.Add(new Label(){Text="Windows 账号（域\\用户名 或邮箱）",AutoSize=true});layout.Controls.Add(account);
        layout.Controls.Add(new Label(){Text="Windows 密码",AutoSize=true,Padding=new Padding(0,8,0,0)});layout.Controls.Add(password);
        layout.Controls.Add(remember);
        var actions=new FlowLayoutPanel(){Dock=DockStyle.Fill,AutoSize=true,FlowDirection=FlowDirection.LeftToRight,Padding=new Padding(0,10,0,0)};
        var clear=new Button(){Text="清除已保存登录",AutoSize=true};var cancel=new Button(){Text="取消",AutoSize=true,DialogResult=DialogResult.Cancel};
        actions.Controls.AddRange([save,clear,cancel]);layout.Controls.Add(actions);layout.Controls.Add(result);Controls.Add(layout);AcceptButton=save;CancelButton=cancel;
        try{using var saved=store.Read();if(saved!=null){account.Text=saved.Account;result.Text="已保存登录信息；输入新密码可更新，也可清除。";}}catch(Exception){result.Text="保存的登录信息暂时不可用，可重新设置或清除。";}
        save.Click+=async(_,_)=>{
            if(busy)return;
            busy=true;save.Enabled=false;clear.Enabled=false;account.Enabled=false;password.Enabled=false;remember.Enabled=false;result.Text="正在验证 Windows 登录…";
            WindowsLogin? login=null;
            try {
                login=new WindowsLogin(account.Text.Trim(),Encoding.Unicode.GetBytes(password.Text));password.Clear();
                await validateLogin(login);
                if(cancelled||IsDisposed)return;
                if(remember.Checked)store.Save(login);else store.Delete();
                Login=login;login=null;busy=false;DialogResult=DialogResult.OK;Close();
            }catch(Exception e){if(!cancelled&&!IsDisposed)result.Text=e.Message;}
            finally{login?.Dispose();busy=false;if(!cancelled&&!IsDisposed){save.Enabled=true;clear.Enabled=true;account.Enabled=true;password.Enabled=true;remember.Enabled=true;password.Focus();}}
        };
        clear.Click+=(_,_)=>{try{store.Delete();result.Text="已清除保存的登录信息。";password.Clear();}catch(Exception e){result.Text=e.Message;}};
        FormClosing+=(_,_)=>{cancelled=DialogResult!=DialogResult.OK;password.Clear();};
    }
}
