// Starter documents for a new company. They are DRAFTS: every job pack and phone screen says so until an
// administrator replaces them with the company's own approved wording and marks them reviewed.
export const STARTER = {
  ra: {
    title: 'Risk assessment: installing, maintaining and removing temporary traffic management',
    rows: [
      [
        'Being struck by passing traffic',
        'Crew',
        'Lay out and take down to the issued drawing and the Code of Practice, face oncoming traffic, keep to the safety zones, work from the protected side, high-visibility clothing to Class 3, works vehicle with beacons as protection.',
        'Medium',
      ],
      [
        'Crossing live carriageway',
        'Crew',
        'Cross only in a clear gap or when traffic is held, at right angles, carrying as little as possible. Hold traffic with signals or Stop/Go boards where a gap cannot be judged safely.',
        'Medium',
      ],
      [
        'Reversing and manoeuvring the works vehicle',
        'Crew, public',
        'Banksman for every reverse, beacons and reversing alarm working, park inside the protected area once it exists.',
        'Low',
      ],
      [
        'Lifting signs, ballast, barriers, signal heads and batteries',
        'Crew',
        'Trained in manual handling, two-person lifts for heavy items, gloves, do not overload the vehicle.',
        'Low',
      ],
      [
        'Pedestrians, cyclists and disabled people passing the works',
        'Public',
        'Keep a safe walking route of the width on the drawing, ramps and tapping rails where needed, signs placed so they do not block the footway.',
        'Low',
      ],
      [
        'Portable signals failing or set wrongly',
        'Crew, public',
        'Check timings and all-red before switching on, carry spare batteries, change to Stop/Go if they fail, follow the permit conditions.',
        'Medium',
      ],
      [
        'Slips and trips',
        'Crew, public',
        'Safety footwear, keep cables and ballast tidy, take care on kerbs, verges and wet surfaces.',
        'Low',
      ],
      [
        'Darkness, bad weather and poor visibility',
        'Crew, public',
        'Lamps where required, longer sign distances when visibility is reduced, stop and call the office in severe weather.',
        'Medium',
      ],
      [
        'Abuse or aggression from the public',
        'Crew',
        'Do not argue, walk away, call 999 if threatened, report every incident to the office.',
        'Low',
      ],
      [
        'Long hours and tiredness',
        'Crew, public',
        'Shifts planned within the company limits, breaks taken, tell the office if you are not fit to work or drive.',
        'Low',
      ],
    ],
  },
  method: {
    title: 'Method statement: temporary traffic management',
    sections: [
      [
        'Scope',
        'Install, maintain and remove the temporary traffic management shown on the issued drawing for this job. Only trained, competent operatives may do this work.',
      ],
      [
        'Before leaving',
        'Do the daily vehicle check. Check the loading list against the van. Read this pack, the drawing and the site hazards. Make sure the job is on your phone before you lose signal.',
      ],
      [
        'On arrival',
        'Park safely with beacons on. Sign in on the app. Compare the site with the drawing and this pack. If they differ or it is unsafe, do not start: send a change request and call the office. Take the arrival photos.',
      ],
      [
        'Installing',
        'Place signs from the furthest advance sign towards the works, with the traffic. Set out tapers, cones and barriers at the spacing on the drawing. Check and switch on signals, or position Stop/Go. Set out the pedestrian route. Take the set-up photos.',
      ],
      [
        'While the works are live',
        'Inspect the layout at the times your photo schedule asks for and after any incident. Put back anything moved or damaged at once. Record any change on the app.',
      ],
      [
        'Removing',
        'Remove in the reverse order, against the traffic, back towards the advance signs. Count the kit back onto the van. Leave the site clear and safe. Take the site clear photos and complete the day on the app.',
      ],
      [
        'Emergencies',
        'Call 999 in an emergency. Make the area safe only if you can do so without risk. Tell the office as soon as you can. Report every accident, near miss and damage on the app.',
      ],
      [
        'Personal protective equipment',
        'Class 3 high-visibility jacket and trousers, safety boots and gloves. Helmet and eye protection where required. Hearing protection available.',
      ],
    ],
  },
  vehicle_checks: {
    title: 'Daily vehicle check',
    items: [
      'Tyres and wheel nuts',
      'Lights and indicators',
      'Beacons and light bar',
      'Mirrors and windows',
      'Windscreen, wipers and washers',
      'Brakes and handbrake',
      'Steering',
      'Horn, reversing alarm and camera',
      'Oil, coolant and other fluids, no leaks',
      'Fuel and AdBlue',
      'Warning lights on the dashboard',
      'Chevrons and markings clean',
      'Load secured',
      'Seat belts',
      'Number plates clean',
      'Trailer or arrow board, if fitted',
      'First aid kit, fire extinguisher and spill kit',
    ],
  },
  hazards: {
    title: 'Site hazards',
    items: [
      'School nearby',
      'Bus stop or bus route',
      'Pedestrian crossing in or near the works',
      'Cycle lane or heavy cycle use',
      'Junction or side road within the works',
      'Bend, brow or poor visibility',
      'Speed limit 40 mph or more',
      'Night or low-light working',
      'Narrow footway or pedestrian diversion',
      'Overhead cables or low structures',
      'Hospital, fire or ambulance route',
      'Level crossing or tramway nearby',
      'Steep gradient',
      'Event, market or busy footfall',
      'Private accesses or driveways affected',
    ],
  },
};
export const TM_TYPES = [
  'Give and take',
  'Stop/Go',
  '2-way lights',
  '3-way lights',
  '4-way lights',
  'Road closure',
  'Lane closure',
  'Convoy',
  'Other',
];
export const VISIT_KINDS = ['install', 'check', 'removal', 'install_remove', 'other'];
export const PHOTO_CATS = ['Before', 'Setup', 'During', 'After', 'Defect', 'Other'];
export const EVENT_KINDS = new Set([
  'accepted',
  'vehicle_check',
  'ra_signoff',
  'drawing_ack',
  'signin',
  'signout',
  'risk_check',
  'loaded',
  'started',
  'returned',
  'note',
  'change_request',
  'day_complete',
  'job_complete',
  'failed_visit',
  'near_miss',
  'checkin',
  'panic',
  'photo_reason',
  'lone_start',
  'lone_stop',
  'installed',
  'location',
]);
// the default photo rules a new company starts with (editable)
export const STARTER_RULES = [
  {
    name: 'Arrival',
    trig: 'event',
    event: 'arrival',
    label: 'Site on arrival, before any work',
    count: 2,
    grace_mins: 10,
  },
  {
    name: 'Set-up complete',
    trig: 'event',
    event: 'setup',
    label: 'Completed layout, from each approach',
    count: 2,
    grace_mins: 15,
  },
  {
    name: 'Site clear',
    trig: 'event',
    event: 'site_clear',
    label: 'Site clear after removal',
    count: 2,
    grace_mins: 15,
  },
];
