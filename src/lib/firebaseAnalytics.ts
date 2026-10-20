import { getAnalytics, isSupported } from 'firebase/analytics';
import { app } from './firebase';

// Kept apart from the app itself, so importing the app for sign-in doesn't start
// Analytics where PUBLIC_ENABLE_ANALYTICS is 'false'. Browser only.
export const analytics = isSupported().then((yes) => (yes ? getAnalytics(app) : null));
