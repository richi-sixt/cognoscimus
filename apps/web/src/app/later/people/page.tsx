import { redirect } from 'next/navigation';

// The people page is shared by the library and Later and lives at /people.
const LegacyPeoplePage = () => redirect('/people');

export default LegacyPeoplePage;
