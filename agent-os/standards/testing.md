---
id: testing
domain: global
version: 3
updated: 2026-02-27
applies_to: ["**/*.spec.ts", "**/*.test.ts"]
---

# Testing

Test patterns and requirements. Config: `vitest.config.mts`

## Quick Reference

```typescript
// React component test
import { render, screen, fireEvent } from '@testing-library/react'
import { MyComponent } from './MyComponent'

describe('MyComponent', () => {
  it('renders with default props', () => {
    render(<MyComponent />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('handles click', async () => {
    const onClick = vi.fn()
    render(<MyComponent onClick={onClick} />)

    await fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
```

## Patterns

### Test Structure
```typescript
describe('Feature', () => {
  // Setup
  beforeEach(() => { ... })
  afterEach(() => { ... })

  describe('when condition', () => {
    it('should behavior', () => {
      // Arrange
      const input = createTestData()

      // Act
      const result = doThing(input)

      // Assert
      expect(result).toBe(expected)
    })
  })
})
```

### Mock Patterns
```typescript
// Mock module
vi.mock('@/services/api', () => ({
  fetchUser: vi.fn()
}))

// Mock implementation
import { fetchUser } from '@/services/api'
vi.mocked(fetchUser).mockResolvedValue({ id: '1', name: 'Test' })

// Spy on method
const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
```

### Async Testing
```typescript
// Wait for element
await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument()
})

// Wait for removal
await waitForElementToBeRemoved(() => screen.queryByText('Loading'))

// User events
import userEvent from '@testing-library/user-event'
const user = userEvent.setup()
await user.type(input, 'text')
```

### NestJS Controller Test
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ResourceController', () => {
  let controller: ResourceController;
  let service: ResourceService;

  const mockResource = { id: 'res-1', schoolId: 'school-1', name: 'Test' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourceController],
      providers: [
        {
          provide: ResourceService,
          useValue: {
            create: vi.fn().mockResolvedValue(mockResource),
            findOne: vi.fn().mockResolvedValue(mockResource),
            findAll: vi.fn().mockResolvedValue([mockResource]),
            update: vi.fn().mockResolvedValue(mockResource),
            remove: vi.fn().mockResolvedValue({ success: true }),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AuthorizedGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ResourceController);
    service = module.get(ResourceService);
  });

  it('should return a resource by id', async () => {
    const result = await controller.findOne('school-1', 'res-1');
    expect(service.findOne).toHaveBeenCalledWith('school-1', 'res-1');
    expect(result).toEqual(mockResource);
  });

  it('should create a resource', async () => {
    const dto = { name: 'New' };
    const result = await controller.create('school-1', { id: 'user-1' } as any, dto);
    expect(service.create).toHaveBeenCalledWith('school-1', 'user-1', dto);
    expect(result).toEqual(mockResource);
  });
});
```

### NestJS Service Test
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

describe('ResourceService', () => {
  let service: ResourceService;
  let mockDb: any;

  const mockResource = { id: 'res-1', schoolId: 'school-1', name: 'Test' };

  beforeEach(async () => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockResource]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([mockResource]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
        {
          provide: DrizzleService,
          useValue: { db: mockDb },
        },
        {
          provide: LoggingService,
          useValue: { log: vi.fn(), error: vi.fn() },
        },
      ],
    }).compile();

    service = module.get(ResourceService);
  });

  it('should return a resource by id', async () => {
    const result = await service.findOne('school-1', 'res-1');
    expect(result).toEqual(mockResource);
  });

  it('should throw NotFoundException when resource not found', async () => {
    mockDb.limit.mockResolvedValue([]);
    await expect(service.findOne('school-1', 'missing')).rejects.toThrow(NotFoundException);
  });
});
```

## Requirements

### Coverage Targets
- Unit tests: 80% for business logic
- Integration: Critical paths covered
- E2E: Happy paths only

### What to Test
- Business logic
- Edge cases
- Error states
- User interactions
- Guard behavior (permission checks)
- NOT: Implementation details
- NOT: Third-party libraries
- NOT: Simple getters/setters

### Test Naming
```typescript
// Pattern: it('should [behavior] when [condition]')
it('should show error when form is invalid')
it('should redirect when user is unauthenticated')
it('should throw NotFoundException when resource missing')
```

### Run Commands
```bash
# All tests
pnpm vitest run

# Specific file
pnpm vitest run src/module/service.spec.ts

# Watch mode
pnpm vitest

# With coverage
pnpm vitest run --coverage
```

## Anti-Patterns

```typescript
// Testing implementation details
expect(component.state.isOpen).toBe(true)

// Snapshot abuse
expect(component).toMatchSnapshot()

// Sleeping instead of waiting
await new Promise(r => setTimeout(r, 1000))

// Testing third-party behavior
expect(axios.get).toHaveBeenCalled()

// Not overriding guards in NestJS tests
// Always .overrideGuard() for JwtAuthGuard and AuthorizedGuard

// Missing vi.fn() — forgetting to mock service methods
// Always provide mock implementations for injected dependencies
```
