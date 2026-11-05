// Pin TZ so date-formatting tests behave identically on every machine/CI.
module.exports = async () => {
  process.env.TZ = 'UTC'
}
