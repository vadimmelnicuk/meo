# Markdown Editor Optimized (MEO)
---
## 0.1.11
- Added inline markdown rendering in table cells
- Added support for markdown code block rendering
- Added frontmatter styling for simple arrays
- Improved mode switching behaviour
- Enhanced table image rendering
- Enhanced inline code styling
- Fixed editor focus during mode toggling
- Fixed initial cursor position in editor and focus on mount

## 0.1.10
- Added HTML and PDF export functionality
- Improved handling of pending changes and flush logic in editor
- Enhanced frontmatter lists handling and styling for YAML fields
- Enhanced table cell editing with inline previews and improved selection styles
- Removed unnecessary multipleOf constraints for line height settings

## 0.1.9
- Added outline controller with drag-and-drop functionality for headings
- Added heading collapse functionality
- Added customizable line height settings for live and source modes
- Added keyboard handling to close find panel with Escape key
- Enhanced task list handling

## 0.1.8
- Added language label for code blocks
- Added outline position customization for the document sidebar
- Added powerquery syntax highlighting

## 0.1.7
- Fixed `Reset Theme to Defaults` so theme/font overrides are cleared correctly at global, workspace, and workspace-folder scopes.
- Improved live-mode thematic break decorations so active-line state and frontmatter boundary rendering stay consistent.

## 0.1.6
- Added settings for theme overrides and per-mode fonts.
- Added a `Markdown Editor Optimized: Reset Theme to Defaults` command to reset all theme colors/fonts to defaults.
- Added line number visibility toggle
- Added rendering for mermaid math blocks

## 0.1.5
- Added wiki link support, including link parsing, local file presense detection, and navigation for `[[...]]` references.
- Added local image source resolution so workspace-relative image paths render correctly in the editor.

## 0.1.4
- Added image insertion and rendering functionality in the editor.

## 0.1.3
- Added support for different list indentations.
- Added frontmatter support with enhanced styling for the editor.
- Added git associations resolver for native source control file loading.
- Improved editor loading time and performance.

## 0.1.2
- Added full find/replace support in the editor, including next/previous navigation, replace current, and replace all.

## 0.1.1
- Improved list handling, including consistent two-space indentation for nested lists.
- Applied packaging and documentation fixes (`package.json`, ignore files, and README updates).

## 0.1.0
- Initial build of the Markdown Editor Optimized (MEO) VSCode extension.
