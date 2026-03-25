# Markdown Editor Optimized (MEO)
---
## 0.1.21
- Added scroll position restoration for long markdown files
- Fixed shortcut handling for local search shortcut to exclude shift key

## 0.1.20
- Added export image mode configuration for HTML export
- Added font weight configuration for headings in theming
- Added ready handshake mechanism for webview
- Removed auto-save feature and related configurations
- Enhanced VSCode API compatibility with fallback state management
- Enhanced copilot handoff
- Updated anchor coordinates for improved selection handling
- Updated global configuration
- Fixed base01 theming issue
- Fixed padding for mode-toolbar when line numbers are hidden

## 0.1.19
- Added support for customizable font weights in theme settings
- Fixed URL boundary decorations
- Fixed agent review handling
- Fixed min-width for hidden line numbers
- Updated configuration for browser path handling
- Updated demo image URL for proper rendering outside of GitHub
- Removed git decorations from no git paths and files in .gitignore

## 0.1.18
- Implemented Theming v2
  - Built-in themes
  - Granular style customisation for individual markdown tags
  - Import/Export themes as JSON
- PR: Extra code block langs (#26)
- Fixed local link handling and navigation
- Various minor improvements

## 0.1.17
- Added latex math rendering
- Added kbd tag parsing and rendering
- Improved auto save stability
- Improved table inline parsing
- Updated demo gif and enhance feature descriptions

## 0.1.16
- Added mermaid colon fences in markdown rendering
- Fixed document offset mapping in applyDocumentChanges function (patch for issue 23)

## 0.1.15
- Added find functionality for whole word and case sensitivity options
- Added GitHub Copilot native change review support
- Fixed link decoration handling in live mode on text selection
- Refactor extension entry point
- Implemented load performance improvements

## 0.1.14
- Added .mdc/.mdx support
- Added collapsible details blocks with summary widget and styling
- Added GitHub alerts render
- Added footnotes
- Added emoji support
- Added floating toolbar display for table cells
- Added draft state synchronization and messaging
- Added git blame support for tables and mermaid diagrams in live mode
- Improved frontmatter HTML export
- Enhanced git diff functionality with live mode renderer
- Fixed z-index for row controls to get hover working

## 0.1.13
- Refactored webview from JS to TS
- Added image paste function with 'assets' as default folder
- Added font size setting
- Fixed top toolbar position
- Fixed numeric lists issue & double enter press behaviour
- Performance improvements

## 0.1.12
- Added Git change visualisations to the left gutter and scroller with toggle functionality
- Added Git blame feature
- Added basic support for merge conflict markers
- Added Vim mode and associated keyboard shortcuts, can be enabled in settings for Source mode
- Added a customisable shortcut to toggle between Live/Source modes, Option+Shift+M is default
- Enhanced list marker handling and indentation logic
- Improved arrow key navigation for list content in live mode
- Improved error handling for live mode transient render issues

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
