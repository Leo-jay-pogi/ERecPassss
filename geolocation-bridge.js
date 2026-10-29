/* Native Capacitor Geolocation bridge, bundled by the Android APK workflows. */
import { Geolocation } from '@capacitor/geolocation';

window.ERecPassNativeGeolocation = {
  async getCurrentPosition(options = {}) {
    let permissions = await Geolocation.checkPermissions();
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
      permissions = await Geolocation.requestPermissions();
    }
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
      throw new Error('Location permission was not granted.');
    }
    return Geolocation.getCurrentPosition(options);
  }
};
