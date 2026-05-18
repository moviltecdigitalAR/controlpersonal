// ============================================================
// GEOLOCALIZACIÓN Y GEOFENCING
// ============================================================

const Geo = (() => {

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

  // Obtener posición GPS con estrategia de 2 intentos:
  // 1º intento: baja precisión + caché de 2 min → responde en ~1s
  // 2º intento: alta precisión + sin caché → si el 1º falló o devolvió mala precisión
  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible en este dispositivo.'));
        return;
      }

      const mensajes = {
        1: 'Permiso de ubicación denegado. Active la ubicación para continuar.',
        2: 'No se pudo obtener la ubicación. Verifique que el GPS esté activo.',
        3: 'Tiempo de espera agotado al obtener la ubicación.'
      };

      // --- Intento rápido: usa posición en caché o antena de red (< 2s) ---
      navigator.geolocation.getCurrentPosition(
        pos => {
          const result = {
            lat:      pos.coords.latitude,
            lng:      pos.coords.longitude,
            accuracy: pos.coords.accuracy
          };
          // Si la precisión es aceptable (≤ 500m) la usamos de inmediato
          // y en paralelo lanzamos la de alta precisión para mejorarla si es posible
          if (pos.coords.accuracy <= 500) {
            resolve(result);
          } else {
            // Precisión muy baja (solo antena), intentar mejorar con GPS real
            _intentarAltaPrecision(resolve, reject, result, mensajes);
          }
        },
        () => {
          // El intento rápido falló → ir directo a alta precisión
          _intentarAltaPrecision(resolve, reject, null, mensajes);
        },
        { enableHighAccuracy: false, timeout: 4000, maximumAge: 120000 }
      );
    });
  }

  function _intentarAltaPrecision(resolve, reject, fallback, mensajes) {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }),
      err => {
        // Si tenemos un resultado de baja precisión lo usamos antes de rechazar
        if (fallback) {
          resolve(fallback);
        } else {
          reject(new Error(mensajes[err.code] || 'Error de geolocalización desconocido.'));
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function checkGeofence(lat, lng, centerLat, centerLng, radiusMeters) {
    const distance = haversine(lat, lng, centerLat, centerLng);
    return {
      inside:   distance <= radiusMeters,
      distance: Math.round(distance)
    };
  }

  return { getCurrentPosition, haversine, checkGeofence };
})();
