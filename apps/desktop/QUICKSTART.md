# Lokus Quick Start Guide

Get up and running with Lokus in **5 minutes**.

---

## 1. Install Lokus

### macOS
```bash
# Download .dmg from releases
https://github.com/lokus-ai/lokus/releases/latest

# Or via Homebrew (coming soon)
brew install lokus
```

### Windows
```bash
# Download installer
https://github.com/lokus-ai/lokus/releases/latest
```

### Linux
```bash
# AppImage
wget https://github.com/lokus-ai/lokus/releases/latest/download/lokus.AppImage
chmod +x lokus.AppImage
./lokus.AppImage
```

---

## 2. Create Your First Workspace

1. **Launch Lokus**
2. **Click "Create New Workspace"**
3. **Choose a folder** (or create new one)
4. **Click "Open"**

Done! Your workspace is ready.

[📹 Video: Creating your first workspace]

---

## 3. Create Your First Note

### Method 1: Quick Create
- Press `Cmd/Ctrl + N`
- Type your content
- Auto-saves as you type

### Method 2: From Sidebar
- Click **"+ New Note"** in sidebar
- Enter title
- Start writing

### Your First Note Structure
```markdown
---
title: My First Note
tags: [getting-started]
date: 2025-10-15
---

# Welcome to Lokus!

This is my first note.

## Features I Want to Try
- [ ] WikiLinks
- [ ] Bases (database views)
- [ ] Knowledge graph
- [ ] Kanban boards

## Notes
Type here...
```

[📹 Video: Creating your first note]

---

## 4. Try Key Features

### WikiLinks - Connect Your Notes
```markdown
I'm learning about [[Lokus]] today.
It integrates well with [[My Projects]].
```
- Type `[[` to see autocomplete
- Click links to navigate
- View backlinks in right panel

### Bases - Database Views
1. Click **"Bases"** in sidebar
2. You'll see all notes in a table!
3. Try:
   - **Sort** - Click column headers
   - **Filter** - Click "Filter" button
   - **Edit** - Click any cell to edit
   - **Group** - Right-click column (coming soon)

[📹 Video: Using Bases]

### Knowledge Graph
1. Click **"Graph"** in sidebar
2. See your notes as connected nodes
3. Try:
   - **Click node** → Opens note
   - **Drag nodes** → Rearrange
   - **Zoom** → Mouse wheel
   - **Toggle 3D** → Button at top

### Kanban Boards
1. Click **"Kanban"** in sidebar
2. Click **"New Board"**
3. Add cards:
   - Click **"+ Add Card"**
   - Or press `N` on keyboard
4. Move cards:
   - **Drag & drop** with mouse
   - **Or use** `H/J/K/L` keys

[📹 Video: Kanban basics]

---

## 5. Connect AI Assistants (Optional)

Lokus includes a built-in MCP server for AI integration!

### Automatic Setup ✨
**It just works!** The MCP server auto-starts when Lokus launches.

### Verify It's Working
1. Look at **status bar** (bottom)
2. Should show: **"MCP: Running" (green)**

### Use with AI
Your AI assistant can now:
- ✅ Read your notes
- ✅ Create new notes
- ✅ Search your workspace
- ✅ Suggest connections
- ✅ Backup and organize
- ✅ 68+ tools available!

**Try asking AI:**
```
"List all notes in my workspace"
"Create a project note for Website Redesign"
"Find all notes about AI"
"Backup my workspace"
```

[📹 Video: AI integration basics]

---

## 6. Customize Your Setup

### Change Theme
1. **Preferences** (Cmd/Ctrl + ,)
2. **Appearance** → **Theme**
3. Choose: Light, Dark, or Auto

### Keyboard Shortcuts
Learn essential shortcuts:
- `Cmd/Ctrl + N` - New note
- `Cmd/Ctrl + P` - Command palette
- `Cmd/Ctrl + \` - Split pane
- `Cmd/Ctrl + Shift + G` - Graph view
- `Cmd/Ctrl + Shift + B` - Bases view

### Editor Settings
**Preferences → Editor:**
- Font size
- Line height
- Auto-save interval
- Spell check
- Vim mode (coming soon)

[📹 Video: Customization tour]

---

## Next Steps

### Learn More
- 📖 [Comprehensive User Guide](/docs/COMPREHENSIVE_USER_GUIDE.md)
- 🗄️ [Bases Complete Guide](/docs/features/BASES_COMPLETE_GUIDE.md)
- 🤖 [MCP Integration Guide](/docs/MCP_INTEGRATION_GUIDE.md)
- 🎨 [Theme Guide](/docs/features/themes.md)

### Join Community
- 💬 [Discord](https://discord.gg/lokus)
- 🐛 [GitHub Issues](https://github.com/lokus-ai/lokus/issues)
- 💡 [Feature Requests](https://github.com/lokus-ai/lokus/discussions)

### Watch Tutorials
- 📹 [YouTube Channel](https://youtube.com/@lokus-ai)
- 📹 [Feature Demos Playlist]
- 📹 [Tips & Tricks]

---

## Troubleshooting

### App Won't Launch
- **macOS**: Allow in System Preferences → Security & Privacy
- **Windows**: Run as Administrator first time
- **Linux**: Make AppImage executable: `chmod +x lokus.AppImage`

### Can't Open Workspace
- Check folder exists and is accessible
- Verify read/write permissions
- Try creating new workspace instead

### MCP Not Working
- Look for "MCP: Running" in status bar
- If stopped, restart Lokus
- Check port 3456 not in use: `lsof -i :3456`

### Slow Performance
- Enable Quantum indexing: Preferences → Performance
- Close unused tabs
- Reduce graph complexity
- Check for large images (compress them)

### Need Help?
- 📧 support@lokus.ai
- 💬 [Discord Support Channel](https://discord.gg/lokus)
- 📖 [Full Documentation](https://docs.lokusmd.com)

---

## Quick Tips

### Productivity
- **Use WikiLinks liberally** - Connect as you think
- **Tag consistently** - Use frontmatter tags for Bases
- **Review backlinks** - Discover unexpected connections
- **Try split pane** - Work on two notes simultaneously

### Organization
- **Use folders** - Organize by project/area/topic
- **Create templates** - For repeated note structures
- **Use Bases** - For project tracking, reading lists, etc.
- **Archive regularly** - Keep workspace focused

### Workflow
- **Inbox → Process → Archive**
- **Daily notes** - Journal template with date
- **Weekly review** - Check Bases views for status
- **Link as you go** - Don't batch linking later

### AI Integration
- **Ask AI to organize** - "Suggest structure for my notes"
- **Use for summaries** - "Summarize this meeting note"
- **Find connections** - "What notes relate to this?"
- **Automate backups** - "Backup weekly on Fridays"

---

## Welcome to Lokus! 🎉

You're all set! Start building your knowledge base.

**Remember:**
- 📝 Your files are just markdown - no lock-in
- 🔒 Everything stays local unless you choose to sync
- 🚀 Features are built-in, no plugins needed
- 🤖 AI integration is automatic and powerful

**Need help?** We're here:
- 💬 Discord: https://discord.gg/lokus
- 📧 Email: support@lokus.ai
- 📖 Docs: https://docs.lokusmd.com

Happy note-taking! ✨

---

**Version:** 1.3.1
**Last Updated:** October 2025
