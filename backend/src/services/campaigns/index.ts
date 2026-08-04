/**
 * Barrel for the campaigns domain services. Mirrors services/scheduling/.
 * The campaigns module reuses scheduling's ScheduleServiceError, resolveScope
 * and AuthReq for consistent error mapping and department scoping.
 */
export * from './campaign.lists.service';
export * from './campaign.permissions';
export * from './campaign.publish.service';
export * from './campaign.schedule.service';
export * from './campaign.projection.service';
export * from './campaign.override.service';
