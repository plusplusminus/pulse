---
id: code-style
domain: global
version: 3
updated: 2026-02-27
applies_to: ["**/*.ts", "**/*.tsx"]
---

# Code Style

TypeScript and React code conventions.

## Quick Reference

```typescript
// Imports order
import { type X } from 'react'           // 1. React
import { clsx } from 'clsx'              // 2. External packages
import { Button } from '@repo/ui'         // 3. Internal packages
import { useAuth } from '@/hooks'         // 4. Local imports
import type { User } from '@/types'       // 5. Type imports last

// Component structure
export function MyComponent({ prop }: Props) {
  // 1. Hooks
  const [state, setState] = useState()

  // 2. Derived values
  const computed = useMemo(() => ..., [dep])

  // 3. Effects
  useEffect(() => { ... }, [dep])

  // 4. Handlers
  const handleClick = () => { ... }

  // 5. Render
  return <div>...</div>
}
```

## Patterns

### Naming
```typescript
// Components: PascalCase
function UserProfile() {}

// Hooks: camelCase with use prefix
function useUserData() {}

// Utils: camelCase
function formatDate() {}

// Constants: UPPER_SNAKE
const MAX_RETRIES = 3

// Types: PascalCase
type UserRole = 'admin' | 'user'
interface UserProps {}
```

### Props
```typescript
// Destructure with defaults
function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  children
}: ButtonProps) {}

// Spread remaining props
function Input({ label, ...props }: InputProps) {
  return <input {...props} />
}
```

### Conditional Rendering
```typescript
// Early return for guards
if (!data) return null

// Ternary for simple
{isLoading ? <Spinner /> : <Content />}

// && for presence
{error && <ErrorMessage />}

// Never nested ternaries
// ❌ {a ? b ? c : d : e}
```

### Event Handlers
```typescript
// Inline for simple
<button onClick={() => setOpen(true)}>

// Named for complex
const handleSubmit = async (e: FormEvent) => {
  e.preventDefault()
  await submitForm(data)
}
```

## Anti-Patterns

```typescript
// ❌ any/unknown without reason
const data: any = fetch()

// ❌ Hardcoded colors
style={{ color: '#FF0000' }}

// ❌ Index as key for dynamic lists
{items.map((item, i) => <Item key={i} />)}

// ❌ Direct DOM manipulation
document.getElementById('x').style.display = 'none'

// ❌ Non-null assertion without guard
user!.name  // Use: user?.name or guard first
```

## File Structure

```
components/
├── ComponentName/
│   ├── index.tsx           # Main component
│   ├── ComponentName.test.tsx
│   └── types.ts            # If types are complex
```
