const Geo = (() => {
  const MAX_ACCEPTED_ACCURACY = 200;
  const TARGET_ACCURACY = 100;
  const MAX_WAIT_MS = 8000;

  function haversine(lat1, lng1, lat2, lng2) {
    const radius = 6371000;
    const radians = value => value * Math.PI / 180;
    const dLat = radians(lat2 - lat1);
    const dLng = radians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('La ubicación no está disponible en este dispositivo.'));
        return;
      }

      let bestPosition = null;
      let highAccuracyFinished = false;
      let lowAccuracyFinished = false;
      let settled = false;

      const timer = setTimeout(() => {
        if (bestPosition && bestPosition.accuracy <= MAX_ACCEPTED_ACCURACY) {
          finish(resolve, bestPosition);
        } else {
          finish(reject, new Error('No se obtuvo una ubicación suficientemente precisa. Active el GPS e intente nuevamente.'));
        }
      }, MAX_WAIT_MS);

      function finish(callback, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      }

      function consider(position, isHighAccuracy) {
        const coords = position.coords;
        const candidate = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy
        };
        if (!bestPosition || candidate.accuracy < bestPosition.accuracy) bestPosition = candidate;

        if (candidate.accuracy <= TARGET_ACCURACY || (isHighAccuracy && candidate.accuracy <= MAX_ACCEPTED_ACCURACY)) {
          finish(resolve, candidate);
          return;
        }

        if (highAccuracyFinished && lowAccuracyFinished) {
          if (bestPosition && bestPosition.accuracy <= MAX_ACCEPTED_ACCURACY) {
            finish(resolve, bestPosition);
          } else {
            finish(reject, new Error('La precisión del GPS no alcanza para validar el área. Active el GPS e intente nuevamente.'));
          }
        }
      }

      function fail(error, isHighAccuracy) {
        if (error && error.code === 1) {
          finish(reject, new Error('Permiso de ubicación denegado. Active la ubicación para continuar.'));
          return;
        }
        if (isHighAccuracy) highAccuracyFinished = true;
        else lowAccuracyFinished = true;

        if (highAccuracyFinished && lowAccuracyFinished) {
          if (bestPosition && bestPosition.accuracy <= MAX_ACCEPTED_ACCURACY) {
            finish(resolve, bestPosition);
          } else {
            const message = error && error.code === 3
              ? 'Se agotó el tiempo para obtener GPS. Active la ubicación e intente nuevamente.'
              : 'No se pudo obtener una ubicación suficientemente precisa. Verifique que el GPS esté activo.';
            finish(reject, new Error(message));
          }
        }
      }

      navigator.geolocation.getCurrentPosition(
        position => {
          highAccuracyFinished = true;
          consider(position, true);
        },
        error => fail(error, true),
        { enableHighAccuracy: true, timeout: MAX_WAIT_MS, maximumAge: 60000 }
      );

      navigator.geolocation.getCurrentPosition(
        position => {
          lowAccuracyFinished = true;
          consider(position, false);
        },
        error => fail(error, false),
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 120000 }
      );
    });
  }

  function checkGeofence(lat, lng, centerLat, centerLng, radiusMeters) {
    const distance = haversine(lat, lng, centerLat, centerLng);
    return { inside: distance <= radiusMeters, distance: Math.round(distance) };
  }

  return { getCurrentPosition, haversine, checkGeofence };
})();
