import Head from 'next/head'
import { WifiSetupPage } from '@/v2/setup/WifiSetupPage'

export default function WifiSetup() {
  return (
    <>
      <Head>
        <title>Set up your t@sk4ce box</title>
      </Head>
      <WifiSetupPage />
    </>
  )
}
