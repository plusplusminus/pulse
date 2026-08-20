---
id: backend
domain: backend
version: 4
updated: 2026-02-27
applies_to: ["apps/backend/src/**/*.ts"]
---

# Backend

NestJS/Drizzle API patterns.

## Quick Reference

```typescript
// Controller — full decorator stack
@ApiTags('resources')
@ApiBearerAuth()
@Controller('resources')
@UseGuards(JwtAuthGuard, AuthorizedGuard)
@UseInterceptors(AuditInterceptor)
export class ResourceController {
  constructor(private readonly service: ResourceService) {}

  @Post()
  @Authorized({ permission: Permission.CREATE })
  @AuditCreate('resource')
  @ApiOperation({ summary: 'Create a resource' })
  async create(
    @CurrentUser() user: any,
    @Body(new ZodValidationPipe(createResourceSchema)) dto: CreateResourceDto,
  ) { return this.service.create(dto, user.id); }

  @Put(':id') @Authorized({ permission: Permission.EDIT }) @AuditUpdate('resource')
  async update(@Param('id') id: string, @Body(new ZodValidationPipe(updateResourceSchema)) dto: UpdateResourceDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id') @Authorized({ permission: Permission.DELETE }) @AuditDelete('resource')
  async remove(@Param('id') id: string) { return this.service.remove(id); }
}

// Service — getCurrentTenantId + event emission
@Injectable()
export class ResourceService {
  constructor(
    private readonly repository: ResourceRepository,
    private readonly eventService: EventService,
  ) {}

  async create(dto: CreateResourceDto, userId: string) {
    const tenantId = getCurrentTenantId();
    if (!tenantId) throw new BadRequestException('No tenant context available');
    const resource = await this.repository.create({ ...dto, schoolId: tenantId });
    await this.eventService.emit(EventType.RESOURCE_CREATED, {
      context: {}, data: { resource },
    });
    return resource;
  }
}
```

## Project Structure
```
src/<module>/
├── controllers/        # HTTP controllers
├── services/           # Business logic
├── repositories/       # Data access (DrizzleService queries)
├── dto/                # Zod schemas + types
├── events/             # Event type definitions
└── resource.module.ts
```

## Tenant Isolation
```typescript
import { getCurrentTenantId } from '../../common/multi-tenant/tenant-context';

// ALWAYS null-check in services/repositories
const tenantId = getCurrentTenantId();
if (!tenantId) throw new BadRequestException('No tenant context available');
// Then filter EVERY query by tenantId + isNull(deletedAt)
```

## Repository Pattern
```typescript
import { TenantAwareRepositoryService } from '../../common/multi-tenant/tenant-aware-repository.service';

@Injectable()
export class ResourceRepository extends TenantAwareRepositoryService {
  constructor(protected readonly drizzle: DrizzleService) { super(drizzle); }

  async findAll(query: QueryDto) {
    const tenantId = getCurrentTenantId();
    if (!tenantId) throw new Error('No tenant context available');
    const conditions = [eq(resources.schoolId, tenantId), isNull(resources.deletedAt)];
    if (query.search) conditions.push(ilike(resources.name, `%${query.search}%`));
    return this.drizzle.db.query.resources.findMany({
      where: and(...conditions),
      orderBy: [asc(resources.name)],
      limit: Math.min(query.limit || 20, 100),
    });
  }
}
```

## Audit Decorators
```typescript
import { AuditCreate, AuditUpdate, AuditDelete } from '../../audit/decorators/audit.decorator';
import { AuditInterceptor } from '../../audit/interceptors/audit.interceptor';

// Class-level: @UseInterceptors(AuditInterceptor)
// Method-level: @AuditCreate('entity'), @AuditUpdate('entity'), @AuditDelete('entity')
// Also: AuditActivate, AuditDeactivate, AuditArchive, AuditUnarchive
```

## Swagger Decorators
```typescript
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
// Class: @ApiTags('resources'), @ApiBearerAuth()
// Method: @ApiOperation({ summary: '...' }), @ApiResponse({ status: 201, description: '...' })
```

## Event Emission
```typescript
import { EventService } from '../../events/services/event.service';
import { EventType } from '../../events/interfaces/base-event.interface';

await this.eventService.emit(EventType.POD_CREATED, {
  context: {},
  data: { pod, gradeLevelId: data.gradeLevelId },
});
```

## Query Patterns
```typescript
// Join
const results = await this.drizzle.db
  .select({ resource: resources, owner: { name: users.name } })
  .from(resources)
  .leftJoin(users, eq(resources.ownerId, users.id))
  .where(and(eq(resources.schoolId, tenantId), isNull(resources.deletedAt)));

// Insert returning
const [created] = await this.drizzle.db
  .insert(resources).values({ id: createId(), schoolId: tenantId, ...dto }).returning();

// Soft delete
await this.drizzle.db.update(resources)
  .set({ deletedAt: new Date(), updatedBy: userId })
  .where(and(eq(resources.id, id), eq(resources.schoolId, tenantId), isNull(resources.deletedAt)));

// Upsert
await this.drizzle.db.insert(resources).values(resource)
  .onConflictDoUpdate({ target: [resources.id], set: { ...dto, updatedAt: new Date() } });
```

## Transactions
```typescript
return this.transactionManager.executeInTransaction(async (tx) => {
  const [created] = await tx.insert(resources).values(resource).returning();
  await tx.insert(auditLogs).values({ resourceId: created.id, action: 'create' });
  return created;
});
```

## DTO Validation (Zod)
```typescript
import { z } from 'zod';
export const createResourceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
});
export type CreateResourceDto = z.infer<typeof createResourceSchema>;
// Controller: @Body(new ZodValidationPipe(createResourceSchema)) dto: CreateResourceDto
// Import: import { ZodValidationPipe } from '../../config/zod-validation.pipe';
```

## Module Registration
```typescript
@Module({
  imports: [DrizzleModule, LoggingModule, CommonModule, RBACModule],
  providers: [ResourceService, ResourceRepository],
  controllers: [ResourceController],
  exports: [ResourceService],
})
export class ResourceModule {}
```

## Errors: Use NestJS built-ins
`NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`, `UnprocessableEntityException`

## Anti-Patterns
- Missing tenant filter on query -- data leak across schools
- No null-check on `getCurrentTenantId()` -- silent failures
- Missing `isNull(deletedAt)` -- returns soft-deleted records
- Missing `@UseInterceptors(AuditInterceptor)` on controller class
- Missing `@AuditCreate`/`@AuditUpdate`/`@AuditDelete` on mutations
- Business logic in controllers -- keep in services
- Raw SQL instead of Drizzle query builder
- `any` types -- always type properly
