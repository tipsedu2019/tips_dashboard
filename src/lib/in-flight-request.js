export function createInFlightRequestStore() {
  const inFlight = new Map()

  return {
    run(key, load) {
      const existing = inFlight.get(key)
      if (existing) return existing

      let loadPromise
      try {
        loadPromise = Promise.resolve(load())
      } catch (error) {
        loadPromise = Promise.reject(error)
      }
      inFlight.set(key, loadPromise)

      const clearOwnedRequest = () => {
        if (inFlight.get(key) === loadPromise) inFlight.delete(key)
      }
      void loadPromise.then(clearOwnedRequest, clearOwnedRequest)
      return loadPromise
    },
  }
}
