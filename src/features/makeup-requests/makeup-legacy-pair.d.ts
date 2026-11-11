export type MakeupLegacyBinding={version:1;mode:'reuse'|'bound';requestId:string;classId:string;requestUpdatedAt:string;cancelDate:string;originalId:string;makeupId:string;startAt:string;endAt:string;classroom:string;occupancy:{id:string;classId:string;className:string;date:string;startMinute:number;endMinute:number;classroom:string;uncertain:false;allRooms:false}};
export function findLegacyMakeupPair(plan:unknown,cancelDate:string,makeupDate:string):{original:Record<string,unknown>;makeup:Record<string,unknown>}|null;
export function isLegacyMakeupBinding(value:unknown):value is MakeupLegacyBinding;
export function matchingLegacyMakeupBinding(request:unknown,slots:unknown,bindings:unknown):MakeupLegacyBinding|null;
export function excludesLegacyMakeupOccupancy(binding:MakeupLegacyBinding|null,row:unknown):boolean;
