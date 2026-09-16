Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = 'Win-Pilot Common Dialog Fixture'
$dialog.FileName = 'fixture.txt'
$dialog.Filter = 'Text files (*.txt)|*.txt|All files (*.*)|*.*'
$null = $dialog.ShowDialog()
$dialog.Dispose()
