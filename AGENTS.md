# Mai Extension Development Guidelines

## Architecture & Design
- **Core Principles**
  - Single responsibility principle
  - Clean data flow between components
  - Minimal dependencies with clear interfaces
  - Feature-driven modularization
- **File Organization**
  - Flat and minimal file structure
  - Modular organization within files using section comments
  - Separate concerns but maintain cohesion between related functionality

## Code Structure & Style
- **Module Pattern**
  - Use ES6 module imports/exports consistently
  - Export only what's necessary (minimize public API)
  - Modular sections within files using: `/****\* MODULAR FUNCTIONALITY NAME \*****/`
- **Naming Conventions**
  - camelCase for variables and functions
  - Descriptive names reflecting purpose and content
  - Clear action verbs for functions (handle*, toggle*, load*, init*, etc.)
  - Consistent naming patterns across related functions
- **Formatting**
  - Consistent indentation (2 spaces)
  - Line breaks between logical sections
  - Group related functions together

## Error Handling & Messaging
- **Error Management**
  - Always check for null/undefined objects before accessing properties
  - Use try/catch blocks for async operations and initialization
  - Provide sensible defaults for missing state
  - Handle extension context invalidation gracefully
- **Message Passing**
  - Use sendMessageSafely helper for all inter-component communication
  - Implement timeouts to prevent hanging (Promise.race with timeout)
  - Add fallbacks when communication fails:
    - Check chrome.runtime.id to detect invalid extension contexts
    - Fall back to chrome.storage.local when background connections fail
- **Logging**
  - Emoji prefixes for console messages:
    - 🌸 (single) cho thông báo thông thường và logs
    - 🌸🌸🌸 (triple) CHỈ dùng cho thông báo lỗi và exceptions
  - Meaningful log messages that aid debugging

## Documentation & Features
- **Code Documentation**
  - JSDoc style comments for all functions
  - Describe parameters, return values, and side effects
  - Document security considerations and limitations
- **Feature Tagging System**
  - Always maintain `FIT` (Feature Indexing Table) in README.md
  - Tag files and functions using: `@feature f01 - Feature Name` 
  - For multi-feature files/functions, include all relevant tags
  - Update feature tables when adding/modifying functionality
  - Example:
    ```javascript
    /**
     * Module description
     * @feature f01 - Feature Name
     */
    
    /**
     * Function description
     * @feature f01 - Feature Name
     */
    function exampleFunction() {
      // Implementation
    }
    ```

## User Experience & Security
- **User Interface**
  - Vietnamese language for all user-facing messages
  - Minimal and non-intrusive notifications
  - Maintain distraction-blocking as a core feature
  - Keep user relaxed and happy (positive messaging)

- **Security Practices** 
  - Follow Chrome extension best practices
  - Avoid over-permissions
  - Sanitize user inputs
  - Document security limitations
  - Protect user data with proper encryption
