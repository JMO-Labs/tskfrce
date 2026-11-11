import Head from 'next/head'
import { RecapPage } from '@/v2/recap/RecapPage'

export default function Recap() {
  return (
    <>
      <Head>
        <title>Your week - t@sk4ce</title>
      </Head>
      <RecapPage />
    </>
  )
}
