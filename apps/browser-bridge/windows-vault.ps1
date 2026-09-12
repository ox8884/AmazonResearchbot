$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ForgeCredentialVault {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Credential {
  public uint Flags, Type;
  public string TargetName, Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize;
  public IntPtr CredentialBlob;
  public uint Persist, AttributeCount;
  public IntPtr Attributes;
  public string TargetAlias, UserName;
 }
 [DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)]
 private static extern bool ReadNative(string target,uint type,uint flags,out IntPtr value);
 [DllImport("advapi32.dll",EntryPoint="CredWriteW",CharSet=CharSet.Unicode,SetLastError=true)]
 private static extern bool WriteNative(ref Credential value,uint flags);
 [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)]
 private static extern bool DeleteNative(string target,uint type,uint flags);
 [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr value);
 public static string Read(string target) {
  IntPtr pointer;
  if(!ReadNative(target,1,0,out pointer)) {
   if(Marshal.GetLastWin32Error()==1168) return null;
   throw new InvalidOperationException("VAULT_UNAVAILABLE");
  }
  try {
   var value=(Credential)Marshal.PtrToStructure(pointer,typeof(Credential));
   if(value.CredentialBlobSize>2560) throw new InvalidOperationException("VAULT_FORMAT");
   var bytes=new byte[value.CredentialBlobSize];
   try { Marshal.Copy(value.CredentialBlob,bytes,0,bytes.Length);return Encoding.UTF8.GetString(bytes); }
   finally { Array.Clear(bytes,0,bytes.Length); }
  } finally { CredFree(pointer); }
 }
 public static void Write(string target,string secret) {
  var bytes=Encoding.UTF8.GetBytes(secret);
  IntPtr blob=Marshal.AllocHGlobal(bytes.Length);
  try {
   Marshal.Copy(bytes,0,blob,bytes.Length);
   var value=new Credential {Type=1,TargetName=target,UserName="Forge Kitchen Ops bridge",CredentialBlobSize=(uint)bytes.Length,CredentialBlob=blob,Persist=2};
   if(!WriteNative(ref value,0)) throw new InvalidOperationException("VAULT_UNAVAILABLE");
  } finally {
   for(int i=0;i<bytes.Length;i++) Marshal.WriteByte(blob,i,0);
   Marshal.FreeHGlobal(blob);Array.Clear(bytes,0,bytes.Length);
  }
 }
 public static void Remove(string target) {
  if(!DeleteNative(target,1,0)) throw new InvalidOperationException("VAULT_UNAVAILABLE");
 }
}
'@
 $inputValue = [Console]::In.ReadToEnd() | ConvertFrom-Json
 if ($inputValue.target -cnotmatch '^ForgeKitchenOps/bridge/[a-f0-9]{64}/[a-f0-9-]{36}$') { throw 'INVALID_TARGET' }
 if ($inputValue.action -notin @('read','create','remove')) { throw 'INVALID_ACTION' }
 if ($inputValue.action -ne 'read' -and $inputValue.credential -cnotmatch '^fbd_[a-f0-9]{64}$') { throw 'INVALID_CREDENTIAL' }
 $sha = [Security.Cryptography.SHA256]::Create()
 try { $mutexName = 'Global\ForgeKitchenOpsBridge' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([Security.Principal.WindowsIdentity]::GetCurrent().User.Value + $inputValue.target)))).Replace('-','') } finally { $sha.Dispose() }
 $mutex = New-Object Threading.Mutex($false,$mutexName)
 $locked = $false
 try {
  try { $locked = $mutex.WaitOne(10000) } catch [Threading.AbandonedMutexException] { $locked=$true }
  if (-not $locked) { throw 'VAULT_BUSY' }
  $existing = [ForgeCredentialVault]::Read($inputValue.target)
  switch ($inputValue.action) {
   'read' { @{credential=$existing} | ConvertTo-Json -Compress }
   'create' {
    if ($null -ne $existing) { throw 'ALREADY_EXISTS' }
    [ForgeCredentialVault]::Write($inputValue.target,$inputValue.credential)
    '{"ok":true}'
   }
   'remove' {
    if ($null -eq $existing -or $existing -cne $inputValue.credential) { throw 'CREDENTIAL_MISMATCH' }
    [ForgeCredentialVault]::Remove($inputValue.target)
    '{"ok":true}'
   }
  }
 } finally { if($locked){$mutex.ReleaseMutex()};$mutex.Dispose() }
} catch {
 [Console]::Out.WriteLine('{"error":"VAULT_OPERATION_FAILED"}')
 exit 1
}
