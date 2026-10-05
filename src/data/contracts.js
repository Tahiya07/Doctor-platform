/** UI-facing contracts. Replace the mock service while preserving these shapes when APIs arrive. */
/** @typedef {{id:string,name:string,slug:string,description:string}} Specialty */
/** @typedef {{id:string,name:string,type:'clinic'|'hospital',address:string,area:string,city:string,distanceKm:number,phone:string,image:string}} Facility */
/** @typedef {{id:string,name:string,specialtyId:string,specialty:string,image:string,qualifications:string[],experienceYears:number,languages:string[],fee:number,verified:boolean,verificationStatus:'pending'|'verified'|'rejected'|'suspended',rating:number,reviewCount:number,location:string,facilityIds:string[],nextAvailable:string,availability:string[]}} Doctor */
/** @typedef {{date:string,startTime:string,endTime:string,status:'available'|'booked'|'unavailable'}} AvailabilitySlot */
/** @typedef {{id:string,doctorId:string,facilityId:string,date:string,time:string,patientName:string,phone:string,email:string,reason:string,status:'confirmed'|'upcoming'|'completed'|'cancelled'}} Appointment */
/** @typedef {{id:string,name:string,phone:string,email:string}} Patient */
/** @typedef {{id:string,participantId:string,participantName:string,participantImage:string,updatedAt:string,unread:number}} Conversation */
/** @typedef {{id:string,conversationId:string,sender:'patient'|'doctor',body:string,sentAt:string}} Message */
