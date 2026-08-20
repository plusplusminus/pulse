---
id: react-best-practices
domain: frontend
version: 3
updated: 2026-02-27
applies_to: ["**/*.tsx", "**/hooks/**/*.ts"]
---

# React & TypeScript Best Practices

React and TypeScript best practices checklist. Use when reviewing or writing React components to ensure code quality, performance, and maintainability.

## Quick Checklist

Before submitting code, verify:

- [ ] Event handlers wrapped in `useCallback`
- [ ] Derived state wrapped in `useMemo`
- [ ] Helper functions defined outside component
- [ ] No duplicate code - extract to shared utilities
- [ ] Components follow Single Responsibility
- [ ] Types imported from `@scaffold/types` where available
- [ ] Permission map values match expected types (arrays vs strings)

---

## Common Issues & Fixes

### 1. Missing `useCallback` for Event Handlers

**Problem**: Event handlers recreated on every render, causing unnecessary child re-renders.

```tsx
// ❌ Bad - recreated every render
function MyComponent() {
  const handleClick = () => {
    doSomething();
  };
  return <Button onClick={handleClick} />;
}

// ✅ Good - stable reference
function MyComponent() {
  const handleClick = useCallback(() => {
    doSomething();
  }, []);
  return <Button onClick={handleClick} />;
}
```

### 2. Inline Helper Functions

**Problem**: Functions defined inside component are recreated every render.

```tsx
// ❌ Bad - inside component
function MyComponent({ user }) {
  const getInitials = (first, last) => {
    return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
  };
  return <Avatar>{getInitials(user.firstName, user.lastName)}</Avatar>;
}

// ✅ Good - outside component
function getInitials(first?: string, last?: string): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

function MyComponent({ user }) {
  return <Avatar>{getInitials(user.firstName, user.lastName)}</Avatar>;
}
```

### 3. Duplicate Utility Functions

**Problem**: Same function defined in multiple files.

```tsx
// ❌ Bad - duplicated in multiple components
function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-ZA', {...});
}

// ✅ Good - shared utility
// lib/utils/date-utils.ts
export const formatDateZA = (dateString?: string, fallback = '-'): string => {...};

// In component
import { formatDateZA } from '@/lib/utils/date-utils';
```

**Common utilities location:**
- Dates: `lib/utils/date-utils.ts`
- Strings: `lib/utils/string-utils.ts`
- Constants: `lib/constants/{domain}.ts`

### 4. Permission Map Type Mismatch

**Problem**: `manage` permission expects an array but receives a string.

```tsx
// ❌ Bad - string when array expected
enrollment: {
  manage: 'ManageEnrollment',  // Will spread to ['M','a','n','a','g','e',...]
}

// ✅ Good - array as expected
enrollment: {
  manage: ['ManageEnrollment'],
}
```

**Check**: `use-resource-permissions.ts` spreads manage: `[...permissionMap.manage]`

### 5. Large Components Violating SRP

**Problem**: Component handles too many responsibilities.

```tsx
// ❌ Bad - one component doing everything
function EnrollmentPage({ id }) {
  // fetching, permissions, navigation, tabs, loading, error, render...
  // 200+ lines
}

// ✅ Good - extracted sub-components
function EnrollmentPageSkeleton() { /* loading UI */ }
function PermissionDenied({ message }) { /* error UI */ }
function StudentHeader({ student, onBack }) { /* header UI */ }

function EnrollmentPage({ id }) {
  // orchestration only
  if (loading) return <EnrollmentPageSkeleton />;
  if (!canView) return <PermissionDenied message="..." />;
  return (
    <StudentHeader ... />
    <EnrollmentContent ... />
  );
}
```

### 6. Type Assertions Instead of Proper Typing

**Problem**: Using `as` bypasses type safety.

```tsx
// ❌ Bad - type assertion
const search = useSearch({ strict: false }) as { tab?: string };
const activeTab = search.tab || 'subjects';

// ✅ Good - validated with fallback
const TAB_VALUES = ['subjects', 'status-history'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const search = useSearch({ strict: false }) as { tab?: string };
const activeTab = useMemo<TabValue>(() => {
  const tab = search.tab;
  return TAB_VALUES.includes(tab as TabValue) ? (tab as TabValue) : 'subjects';
}, [search.tab]);
```

### 7. Missing Accessibility Attributes

**Problem**: Decorative elements without proper ARIA attributes.

```tsx
// ❌ Bad - no accessibility info
<span className="text-muted">→</span>
<span>↑</span>

// ✅ Good - with accessibility
<span className="text-muted" aria-hidden="true">→</span>
<span aria-label="Cross-grade enrollment" title="Cross-grade enrollment">↑</span>
```

### 8. Duplicate Constants

**Problem**: Same constants defined in multiple files.

```tsx
// ❌ Bad - duplicated
// file1.tsx
const STATUS_VARIANTS = { active: 'default', withdrawn: 'destructive' };
// file2.tsx
const STATUS_VARIANTS = { active: 'default', completed: 'outline' };

// ✅ Good - shared constants
// lib/constants/enrollment.ts
export const ENROLLMENT_STATUS_VARIANTS = {
  active: 'default',
  withdrawn: 'destructive',
  completed: 'outline',
  // all variants in one place
} as const;
```

---

## SOLID Principles in React

### Single Responsibility (SRP)
- Each component should have one reason to change
- Extract loading states, error states, and sub-sections into separate components

### Open/Closed (OCP)
- Add new features by extending (adding to constants/utilities), not modifying
- Use composition over modification

### Interface Segregation (ISP)
- Components should receive only props they need
- Don't pass entire objects when only one field is used

### Dependency Inversion (DIP)
- Import shared utilities instead of hardcoding
- Use TypeScript interfaces for dependencies

---

## File Structure Convention

```
components/{domain}/
├── {domain}-page.tsx           # Main page (orchestration)
├── {domain}-summary-card.tsx   # Display component
├── {domain}-table.tsx          # Table/list component
└── {domain}-form.tsx           # Form component

lib/
├── constants/
│   └── {domain}.ts             # Domain-specific constants
└── utils/
    ├── date-utils.ts           # Date formatting
    └── string-utils.ts         # String formatting
```

---

## Review Commands

```bash
# Type check
pnpm --filter @scaffold/frontend type-check

# Build verification
pnpm --filter @scaffold/frontend build

# Lint
pnpm --filter @scaffold/frontend lint
```
