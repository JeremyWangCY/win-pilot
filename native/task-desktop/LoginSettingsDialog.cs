using System.Security.Principal;
using System.Text;

namespace WinPilotTaskDesktop;

// Matches the harness surface: paper background, ink text, one accent action, and
// one subtle secondary style. Colors come from Palette so the dialog and the task
// window cannot drift apart.
class LoginSettingsDialog : Form
{
    readonly TextBox account=new(){Name="windows_account",Dock=DockStyle.Fill,MaxLength=512};
    readonly TextBox password=new(){Name="windows_password",Dock=DockStyle.Fill,UseSystemPasswordChar=true,MaxLength=512};
    readonly Label result=new(){Name="login_result",AutoSize=true,MaximumSize=new(474,0),ForeColor=Palette.InkSoft};
    readonly CheckBox remember=new(){Name="remember_login",Text="在本机记住登录，后续自动连接",AutoSize=true,Checked=true,ForeColor=Palette.InkSoft};
    readonly WindowsLoginStore store;
    readonly Button save=new(){Text="验证并保存",AutoSize=true};
    bool busy,cancelled;
    internal WindowsLogin? Login { get; private set; }

    static Label Caption(string text,float size=9f,FontStyle style=FontStyle.Regular,Color? color=null,float top=0f)=>
        new(){Text=text,AutoSize=true,Font=new Font("Microsoft YaHei UI",size,style),ForeColor=color??Palette.Ink,Margin=new Padding(0,(int)top,0,0)};

    static TextBox StyleField(TextBox box){box.BorderStyle=BorderStyle.FixedSingle;box.BackColor=Palette.Paper;box.ForeColor=Palette.Ink;box.Margin=new Padding(0,6,0,0);return box;}

    static Button StyleAction(Button b,bool primary)
    {
        // Size each button to its own text: a fixed MinimumSize let the three-button
        // row wrap "清除已保存登录" onto two lines at 100% DPI.
        b.AutoSize=true;b.AutoSizeMode=AutoSizeMode.GrowAndShrink;b.Padding=new Padding(16,0,16,0);
        b.MinimumSize=new Size(0,32);b.FlatStyle=FlatStyle.Flat;b.Margin=new Padding(0,0,8,0);
        b.TabStop=false;
        b.FlatAppearance.BorderSize=primary?0:1;
        if(primary){b.BackColor=Palette.Ink;b.ForeColor=Palette.Paper;b.FlatAppearance.MouseOverBackColor=Palette.InkSoft;b.FlatAppearance.MouseDownBackColor=Palette.Ink;}
        else{b.BackColor=Palette.Paper;b.ForeColor=Palette.Ink;b.FlatAppearance.BorderColor=Palette.Line;b.FlatAppearance.MouseOverBackColor=Palette.Hover;b.FlatAppearance.MouseDownBackColor=Palette.LineSoft;}
        return b;
    }

    internal LoginSettingsDialog(WindowsLoginStore? loginStore=null,Func<WindowsLogin,Task>? validateLogin=null)
    {
        store=loginStore??new WindowsLoginStore();
        validateLogin??=value=>Task.Run(value.ValidateCurrentUser);
        Text="Win-Pilot · 独立桌面登录设置";ClientSize=new(540,352);FormBorderStyle=FormBorderStyle.FixedDialog;
        MaximizeBox=false;MinimizeBox=false;ShowIcon=false;StartPosition=FormStartPosition.CenterParent;
        BackColor=Palette.Paper;ForeColor=Palette.Ink;Font=new Font("Microsoft YaHei UI",9);

        using var current=WindowsIdentity.GetCurrent();account.Text=current.Name;

        var layout=new TableLayoutPanel(){Dock=DockStyle.Fill,Padding=new Padding(24,20,24,18),ColumnCount=1,RowCount=10,AutoScroll=true,BackColor=Palette.Paper};
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100f));

        layout.Controls.Add(Caption("首次设置 Windows 登录信息",12.5f,FontStyle.Bold));
        layout.Controls.Add(Caption("请填写当前 Windows 用户的密码（不是 PIN）。勾选记住后，\nWin-Pilot 会使用 Windows 加密保存，后续自动取回登录。",9f,FontStyle.Regular,Palette.InkSoft,6));
        layout.Controls.Add(Caption("Windows 账号（域\\用户名 或邮箱）",9f,FontStyle.Regular,Palette.InkSoft,10));
        layout.Controls.Add(StyleField(account));
        layout.Controls.Add(Caption("Windows 密码",9f,FontStyle.Regular,Palette.InkSoft,10));
        layout.Controls.Add(StyleField(password));
        layout.Controls.Add(remember);
        remember.Margin=new Padding(0,12,0,0);

        var actions=new FlowLayoutPanel(){Dock=DockStyle.Fill,AutoSize=true,FlowDirection=FlowDirection.LeftToRight,Padding=new Padding(0,16,0,0),BackColor=Palette.Paper};
        var clear=new Button(){Text="清除已保存登录",AutoSize=true};
        var cancel=new Button(){Text="取消",AutoSize=true,DialogResult=DialogResult.Cancel};
        StyleAction(save,true);StyleAction(clear,false);StyleAction(cancel,false);
        actions.Controls.AddRange([save,clear,cancel]);
        layout.Controls.Add(actions);
        layout.Controls.Add(result);
        result.Margin=new Padding(0,10,0,0);

        Controls.Add(layout);AcceptButton=save;CancelButton=cancel;

        try{using var saved=store.Read();if(saved!=null){account.Text=saved.Account;result.Text="已保存登录信息；输入新密码可更新，也可清除。";}}
        catch(Exception){result.Text="保存的登录信息暂时不可用，可重新设置或清除。";}

        save.Click+=async(_,_)=>{
            if(busy)return;
            busy=true;save.Enabled=false;clear.Enabled=false;account.Enabled=false;password.Enabled=false;remember.Enabled=false;
            result.ForeColor=Palette.InkSoft;result.Text="正在验证 Windows 登录…";
            WindowsLogin? login=null;
            try {
                login=new WindowsLogin(account.Text.Trim(),Encoding.Unicode.GetBytes(password.Text));password.Clear();
                await validateLogin(login);
                if(cancelled||IsDisposed)return;
                if(remember.Checked)store.Save(login);else store.Delete();
                Login=login;login=null;busy=false;DialogResult=DialogResult.OK;Close();
            }catch(Exception e){
                if(!cancelled&&!IsDisposed){result.ForeColor=Color.FromArgb(0xEF,0x44,0x44);result.Text=e.Message;}
            }
            finally{login?.Dispose();busy=false;if(!cancelled&&!IsDisposed){save.Enabled=true;clear.Enabled=true;account.Enabled=true;password.Enabled=true;remember.Enabled=true;password.Focus();}}
        };
        clear.Click+=(_,_)=>{try{store.Delete();result.ForeColor=Palette.InkSoft;result.Text="已清除保存的登录信息。";password.Clear();}catch(Exception e){result.ForeColor=Color.FromArgb(0xEF,0x44,0x44);result.Text=e.Message;}};
        FormClosing+=(_,_)=>{cancelled=DialogResult!=DialogResult.OK;password.Clear();};
    }
}
