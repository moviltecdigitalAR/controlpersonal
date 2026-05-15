// ============================================================
// GEOLOCALIZACIÓN Y GEOFENCING
// ============================================================

const Geo = (() => {

  // Distancia en metros entre dos puntos GPS (fórmula Haversine)
  function haversine(lat1, lon1, lat2, lon2) {
    const R    = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Obtener posición GPS actual como Promise
  function getCurrentPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible en este dispositivo.'));
        return;
      }

      const defaultOpts = {
        timeout:            15000,
        maximumAge:         30000,
        enableHighAccuracy: true
      };

      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
        err => {
          const msgs = {
            1: 'Permiso de ubicación denegado. Active la ubicación para continuar.',
            2: 'No se pudo obtener la ubicación. Verifique que el GPS esté activo.',
            3: 'Tiempo de espera agotado al obtener la ubicación.'
          };
          reject(new Error(msgs[err.code] || 'Error de geolocalización desconocido.'));
        },
        { ...defaultOpts, ...options }
      );
    });
  }

  // Verificar si una posición está dentro del radio permitido
  function checkGeofence(lat, lng, centerLat, centerLng, radiusMeters) {
    const distance = haversine(lat, lng, centerLat, centerLng);
    return {
      inside:   distance <= radiusMeters,
      distance: Math.round(distance)
    };
  }

  return { getCurrentPosition, haversine, checkGeofence };
})();
