import Head from 'next/head'
import { KidPage } from '@/v2/kid/KidPage'

export default function Kid() {
  return (
    <>
      <Head>
        <title>t@sk4ce</title>
        <link rel="manifest" href="/kid.webmanifest" key="manifest" />
      </Head>
      <KidPage />
    </>
  )
}
