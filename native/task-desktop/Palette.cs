// Colors mirror the harness's design tokens so every Win-Pilot surface belongs to
// the same product as the panel that opens it. Values are transcribed from the
// harness palette rather than picked by eye: brand-primary resolves to
// neutral-bluish-1000 (a near black), and the blue ramp is reserved for accents.

// This lives outside Program.cs because the native test projects compile the
// window sources without the host entry point, and the palette must resolve there
// too.
static class Palette
{
    internal static readonly System.Drawing.Color Paper     = System.Drawing.Color.FromArgb(0xFF,0xFF,0xFF); // neutral-bluish-00
    internal static readonly System.Drawing.Color PaperTile = System.Drawing.Color.FromArgb(0xF9,0xFA,0xFB); // neutral-bluish-50
    internal static readonly System.Drawing.Color Ink       = System.Drawing.Color.FromArgb(0x0F,0x11,0x15); // neutral-bluish-1000, also brand-primary
    internal static readonly System.Drawing.Color InkSoft   = System.Drawing.Color.FromArgb(0x61,0x66,0x6B); // neutral-bluish-700, label-secondary
    internal static readonly System.Drawing.Color InkFaint  = System.Drawing.Color.FromArgb(0x97,0x9D,0xA6); // neutral-bluish-500
    internal static readonly System.Drawing.Color Line      = System.Drawing.Color.FromArgb(0xE1,0xE5,0xEE); // neutral-bluish-200
    internal static readonly System.Drawing.Color LineSoft  = System.Drawing.Color.FromArgb(0xEB,0xEE,0xF2); // neutral-bluish-100
    internal static readonly System.Drawing.Color Accent    = System.Drawing.Color.FromArgb(0x3B,0x82,0xF6); // blue-500
    internal static readonly System.Drawing.Color Hover     = System.Drawing.Color.FromArgb(0xF1,0xF3,0xF5); // neutral-bluish-75
    internal static readonly System.Drawing.Color Danger    = System.Drawing.Color.FromArgb(0xEF,0x44,0x44); // static-red-500
    internal static readonly System.Drawing.Color Shadow    = System.Drawing.Color.FromArgb(0x1A,0x00,0x00,0x00); // border-l2
}
