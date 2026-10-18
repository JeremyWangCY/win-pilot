Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using TYPEATTR=System.Runtime.InteropServices.ComTypes.TYPEATTR;
using FUNCDESC=System.Runtime.InteropServices.ComTypes.FUNCDESC;
using VARDESC=System.Runtime.InteropServices.ComTypes.VARDESC;
public static class RdpTypeProbe {
 [DllImport("oleaut32.dll",CharSet=CharSet.Unicode)] static extern int LoadTypeLibEx(string path,int kind,out ITypeLib value);
 public static string Run() { var output=new System.Text.StringBuilder();
  ITypeLib library;Marshal.ThrowExceptionForHR(LoadTypeLibEx(Environment.SystemDirectory+"\\mstscax.dll",2,out library));
  for(int i=0;i<library.GetTypeInfoCount();i++) {
   string name,doc,file;int ctx;library.GetDocumentation(i,out name,out doc,out ctx,out file);
   if(name!="IMsRdpInputSink"&&name!="KbdCodeType"&&name!="IMsRdpClientNonScriptable")continue;
   ITypeInfo type;library.GetTypeInfo(i,out type);IntPtr attr;type.GetTypeAttr(out attr);
   var a=(TYPEATTR)Marshal.PtrToStructure(attr,typeof(TYPEATTR));output.AppendLine(name+" "+a.guid);
   for(int j=0;j<a.cFuncs;j++){IntPtr ptr;type.GetFuncDesc(j,out ptr);var d=(FUNCDESC)Marshal.PtrToStructure(ptr,typeof(FUNCDESC));string f;type.GetDocumentation(d.memid,out f,out doc,out ctx,out file);output.AppendLine(f+" vtable="+d.oVft+" params="+d.cParams);type.ReleaseFuncDesc(ptr);}
   for(int j=0;j<a.cVars;j++){IntPtr ptr;type.GetVarDesc(j,out ptr);var d=(VARDESC)Marshal.PtrToStructure(ptr,typeof(VARDESC));string f;type.GetDocumentation(d.memid,out f,out doc,out ctx,out file);output.AppendLine(f+"="+Marshal.GetObjectForNativeVariant(d.desc.lpvarValue));type.ReleaseVarDesc(ptr);}
   type.ReleaseTypeAttr(attr);
  }
 return output.ToString(); }
}
'@
[RdpTypeProbe]::Run()

