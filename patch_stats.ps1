$path = Join-Path $PSScriptRoot "src\pages\AdminDashboard.jsx"
$content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

# Fix 1: Replace hardcoded "12" avg wait with live value
$content = $content.Replace(">12</span>", ">{avgWaitMins}</span>")

# Fix 2: Replace hardcoded fast pass revenue block
$old = '<span className="text-3xl font-headline font-bold text-secondary">' + [char]0x20B9 + '1,240</span>'
$new = @"
{fastPassPriceNum > 0 ? (
                         <>
                           <span className="text-3xl font-headline font-bold text-secondary">Rs.{fastPassRevenue.toLocaleString("en-IN")}</span>
                           <p className="text-[10px] text-on-surface-variant mt-1">{fastPassInQueue} active &middot; Rs.{fastPassPriceNum}/pass</p>
                         </>
                       ) : (
                         <span className="text-sm text-on-surface-variant">Set price in Settings</span>
                       )}
"@
$content = $content.Replace($old, $new.Trim())

[System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)
Write-Host "Done patching AdminDashboard.jsx"
