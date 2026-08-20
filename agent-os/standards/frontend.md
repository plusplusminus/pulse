---
id: frontend
domain: frontend
version: 3
updated: 2026-02-27
applies_to: ["apps/frontend/src/**/*.tsx", "apps/frontend/src/**/*.ts"]
---

# Frontend

Vite + React 19 + TanStack Router + TanStack Query + shadcn/ui (new-york style).

## Quick Reference

```tsx
import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/dashboard/people/students')({ component: StudentsPage });

// Route with params + loader prefetch
export const Route = createFileRoute('/dashboard/people/students/$studentId')({
  loader: ({ params, context }) => context.queryClient.ensureQueryData({
    queryKey: ['student', params.studentId],
    queryFn: () => studentService.getStudent(params.studentId),
  }),
  component: StudentProfile,
});
const { studentId } = Route.useParams();

// Key imports
import { cn } from '@/lib/utils';                       // class merging
import { toast } from 'sonner';                          // notifications
import { apiClient } from '@/lib/utils/api/api-client';  // HTTP client
import type { SomeDto } from '@scaffold/types';           // shared types
```

## Patterns

### TanStack Router

Routes in `src/routes/` auto-generate `routeTree.gen.ts`. Layout routes render `<Outlet />`.

```tsx
import { createFileRoute, Outlet, useSearch, useNavigate, redirect } from '@tanstack/react-router';

const searchSchema = z.object({ schoolId: z.string().optional() });

export const Route = createFileRoute('/dashboard')({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    const role = await apiClient.get<RoleContext>('auth/role-context');
    if (role.isStudent) throw redirect({ to: '/student' });
    await context.queryClient.ensureQueryData({ queryKey: ['grades'], queryFn: fetchGrades });
  },
  component: () => { const search = useSearch({ from: '/dashboard' }); return <Layout><Outlet /></Layout>; },
});

// __root.tsx provides QueryClient to all routes
interface RouterContext { queryClient: QueryClient; }
export const Route = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

// Navigation
navigate({ to: '/dashboard/people/students/$studentId', params: { studentId: id } });
navigate({ to: '/dashboard', search: {}, replace: true });
```

### TanStack Query

Query key factories in hook files. Services handle API calls.

```tsx
const gradebookKeys = {
  all: ['gradebook'] as const,
  list: () => [...gradebookKeys.all, 'list'] as const,
  detail: (params: GetGradebookDto) => [...gradebookKeys.all, 'detail', params] as const,
};

export function useGradebook(params: GetGradebookDto, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: gradebookKeys.detail(params),
    queryFn: () => gradebookService.getGradebook(params),
    enabled: (opts?.enabled ?? true) && !!params.gradeId,
  });
}

export function useCreateMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMarkDto) => gradebookService.createMark(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: gradebookKeys.all }),
    onError: (err: any) => toast({ title: 'Error', description: err.response?.data?.message || 'Failed', variant: 'destructive' }),
  });
}
```

### Services (API Layer)

Services wrap `apiClient` from `@/lib/utils/api/api-client`. Types from `@scaffold/types`.

```tsx
export const studentService = {
  async getStudents(query: StudentListQuery): Promise<PaginatedStudents> {
    return apiClient.students.getAll<PaginatedStudents>(query);
  },
  async getStudent(id: string): Promise<Student> { return apiClient.students.getById<Student>(id); },
};
```

### Forms (React Hook Form + Zod + shadcn Form)

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const schema = z.object({ userId: z.string().min(1, 'Required'), scopeType: z.enum(['school', 'grade']) });
type FormData = z.infer<typeof schema>;

function ScopeForm({ onSubmit }: { onSubmit: (d: FormData) => Promise<void> }) {
  const form = useForm<FormData>({ resolver: zodResolver(schema) });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField control={form.control} name="scopeType" render={({ field }) => (
          <FormItem>
            <FormLabel>Scope</FormLabel>
            <FormControl><Select onValueChange={field.onChange} value={field.value}>...</Select></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit">Save</Button>
      </form>
    </Form>
  );
}
```

### Zustand (Client State)

```tsx
import { create } from 'zustand';
export const useFilterStore = create<State & Actions>((set) => ({
  gradeId: null,
  setGrade: (gradeId) => set({ gradeId }),
  reset: () => set(initialState),
}));
// Selector hooks prevent unnecessary rerenders
export const useFilterValues = () => useFilterStore(s => ({ gradeId: s.gradeId, subject: s.subject }));
```

### Styling

shadcn/ui (new-york) + Tailwind CSS v4. Icons: `lucide-react`. Use `cn()` for conditional classes.

```tsx
<div className={cn('flex items-center border-b bg-background px-4', isCollapsed && 'justify-center')} />
className="text-muted-foreground bg-muted/10"   // correct: semantic tokens
style={{ color: '#6b7280' }}                     // wrong: inline hex
```

## File Structure

```
src/
├── routes/              # File-based routes (routeTree.gen.ts)
│   ├── __root.tsx       # Root layout + QueryClient context
│   ├── dashboard.tsx    # Dashboard layout (<Outlet />)
│   └── dashboard/       # Nested dashboard routes
├── components/ui/       # shadcn primitives (Button, Card, Form...)
├── components/[domain]/ # Domain components (students/, attendance/)
├── features/            # Feature modules (gradebook, enrollments)
├── hooks/queries/       # TanStack Query hooks with key factories
├── services/            # API service objects (apiClient wrappers)
├── stores/              # Zustand stores
├── contexts/            # React contexts (auth-context)
├── lib/utils.ts         # cn() utility
├── lib/utils/api/       # apiClient, error types
├── schemas/             # Zod validation schemas
├── types/               # Frontend-only TypeScript types
└── styles/global.css    # Tailwind v4 entry
```

## Anti-Patterns

```tsx
useEffect(() => { fetchData() }, [])                // use useQuery, not useEffect
const res = await fetch('/api/students');            // use apiClient via services
{items.map((item, i) => <Item key={i} />)}          // use item.id as key
useQuery({ queryKey: ['gradebook', id] })            // use key factories
style={{ color: '#0F172A' }}                         // use Tailwind semantic tokens
state.gradeId = 'abc';                               // use zustand set()
```
