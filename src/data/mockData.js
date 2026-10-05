/** Demo-only frontend data. No personal data is real. */
export const specialties = [
  { id: 'cardiology', name: 'Cardiology', slug: 'cardiology', description: 'Heart & circulation' },
  { id: 'dermatology', name: 'Dermatology', slug: 'dermatology', description: 'Skin & hair' },
  { id: 'pediatrics', name: 'Pediatrics', slug: 'pediatrics', description: 'Children’s health' },
  { id: 'dentistry', name: 'Dentistry', slug: 'dentistry', description: 'Dental care' },
  { id: 'neurology', name: 'Neurology', slug: 'neurology', description: 'Brain & nerves' },
  { id: 'gynecology', name: 'Gynecology', slug: 'gynecology', description: 'Women’s health' },
];

export const facilities = [
  { id: 'f1', name: 'Carewell Medical Centre', type: 'clinic', address: 'House 18, Road 27', area: 'Dhanmondi', city: 'Dhaka', distanceKm: 1.8, phone: '+880 2 5500 1200', image: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=900&q=80' },
  { id: 'f2', name: 'Lakeside Specialist Hospital', type: 'hospital', address: 'Plot 6, Road 71', area: 'Gulshan', city: 'Dhaka', distanceKm: 3.4, phone: '+880 2 5881 4500', image: 'https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=900&q=80' },
  { id: 'f3', name: 'Greenline Family Clinic', type: 'clinic', address: 'House 9, Road 11', area: 'Banani', city: 'Dhaka', distanceKm: 5.2, phone: '+880 2 8822 1000', image: 'https://images.unsplash.com/photo-1631815588090-d4bfec5b1ccb?auto=format&fit=crop&w=900&q=80' },
];

export const doctors = [
  { id: 'd1', name: 'Dr. Arif Rahman', specialtyId: 'cardiology', specialty: 'Cardiologist', image: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=700&q=85', qualifications: ['MBBS', 'FCPS'], experienceYears: 12, languages: ['Bangla', 'English'], fee: 1500, verified: true, rating: 4.9, reviewCount: 128, location: 'Dhanmondi, Dhaka', facilityIds: ['f1', 'f2'], nextAvailable: 'Today, 5:30 PM', availability: ['Today', 'Tomorrow', 'This week'] },
  { id: 'd2', name: 'Dr. Nusrat Jahan', specialtyId: 'dermatology', specialty: 'Dermatologist', image: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=700&q=85', qualifications: ['MBBS', 'DDV', 'FCPS'], experienceYears: 9, languages: ['Bangla', 'English'], fee: 1200, verified: true, rating: 5.0, reviewCount: 96, location: 'Gulshan, Dhaka', facilityIds: ['f2'], nextAvailable: 'Today, 4:00 PM', availability: ['Today', 'Tomorrow', 'This week'] },
  { id: 'd3', name: 'Dr. Farhan Ahmed', specialtyId: 'pediatrics', specialty: 'Pediatrician', image: 'https://images.unsplash.com/photo-1594824476967-48c8b964273f?auto=format&fit=crop&w=700&q=85', qualifications: ['MBBS', 'FCPS', 'MD'], experienceYears: 15, languages: ['Bangla', 'English'], fee: 1000, verified: true, rating: 4.9, reviewCount: 74, location: 'Dhanmondi, Dhaka', facilityIds: ['f1', 'f3'], nextAvailable: 'Tomorrow, 10:30 AM', availability: ['Tomorrow', 'This week'] },
  { id: 'd4', name: 'Dr. Samira Chowdhury', specialtyId: 'dentistry', specialty: 'Dental Surgeon', image: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=700&q=85', qualifications: ['BDS', 'FCPS'], experienceYears: 11, languages: ['Bangla', 'English'], fee: 800, verified: true, rating: 4.8, reviewCount: 82, location: 'Banani, Dhaka', facilityIds: ['f3'], nextAvailable: 'Today, 6:00 PM', availability: ['Today', 'This week'] },
  { id: 'd5', name: 'Dr. Tasnim Haque', specialtyId: 'gynecology', specialty: 'Gynecologist', image: 'https://images.unsplash.com/photo-1622902046580-2b47f47f5471?auto=format&fit=crop&w=700&q=85', qualifications: ['MBBS', 'FCPS'], experienceYears: 14, languages: ['Bangla', 'English'], fee: 1800, verified: true, rating: 4.9, reviewCount: 110, location: 'Gulshan, Dhaka', facilityIds: ['f2'], nextAvailable: 'Tomorrow, 11:00 AM', availability: ['Tomorrow', 'This week'] },
  { id: 'd6', name: 'Dr. Mahmud Hasan', specialtyId: 'neurology', specialty: 'Neurologist', image: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&w=700&q=85', qualifications: ['MBBS', 'MD', 'FCPS'], experienceYears: 18, languages: ['Bangla', 'English'], fee: 2000, verified: false, rating: 4.7, reviewCount: 58, location: 'Dhanmondi, Dhaka', facilityIds: ['f1'], nextAvailable: 'Thu, 3:30 PM', availability: ['This week'] },
].map((doctor) => ({ ...doctor, verificationStatus: doctor.verified ? 'verified' : 'pending' }));

export const initialAppointments = [
  { id: 'a1', doctorId: 'd1', facilityId: 'f1', date: '2026-10-07', time: '5:30 PM', patientName: 'Rafia Sultana', phone: '+880 1712 345678', email: 'rafia@example.com', reason: 'Routine heart health check', status: 'confirmed' },
  { id: 'a2', doctorId: 'd2', facilityId: 'f2', date: '2026-10-12', time: '4:00 PM', patientName: 'Rafia Sultana', phone: '+880 1712 345678', email: 'rafia@example.com', reason: 'Skin consultation', status: 'upcoming' },
  { id: 'a3', doctorId: 'd3', facilityId: 'f1', date: '2026-09-18', time: '10:30 AM', patientName: 'Rafia Sultana', phone: '+880 1712 345678', email: 'rafia@example.com', reason: 'Annual check-up', status: 'completed' },
];

export const initialConversations = [
  { id: 'c1', participantId: 'd1', participantName: 'Dr. Arif Rahman', participantImage: doctors[0].image, updatedAt: '10:42 AM', unread: 1 },
  { id: 'c2', participantId: 'd2', participantName: 'Dr. Nusrat Jahan', participantImage: doctors[1].image, updatedAt: 'Yesterday', unread: 0 },
];

export const initialMessages = {
  c1: [
    { id: 'm1', conversationId: 'c1', sender: 'doctor', body: 'Hello Rafia, I’ve reviewed your notes. Let me know if you have any questions before your visit.', sentAt: '10:35 AM' },
    { id: 'm2', conversationId: 'c1', sender: 'patient', body: 'Thank you, doctor. Should I bring my recent test results?', sentAt: '10:39 AM' },
    { id: 'm3', conversationId: 'c1', sender: 'doctor', body: 'Yes please, that would be helpful. See you on Wednesday.', sentAt: '10:42 AM' },
  ],
  c2: [{ id: 'm4', conversationId: 'c2', sender: 'doctor', body: 'Your prescription is ready. Please bring it to your next visit.', sentAt: 'Yesterday' }],
};

export const adminSummary = { pendingDoctors: 4, totalDoctors: 248, appointmentsToday: 36, activeFacilities: 18, monthlyAppointments: [38, 52, 45, 68, 58, 82, 74, 95, 78, 112, 93, 126] };
