package resist

import (
	"testing"
	"time"
)

const (
	lan       = "10.0.0.0/8"
	lan6      = "fe80::/10"
	boxMAC    = "bb:bb:bb:bb:bb:02"
	gwMAC     = "aa:aa:aa:aa:aa:01"
	kidMAC    = "cc:cc:cc:cc:cc:03"
	kidIP     = "10.0.0.5"
	kidIP6    = "fe80::5"
	inet      = "203.0.113.9"
	inet6     = "2001:db8::9"
)

func testCounter(threshold int, window float64) (*Counter, *mockClock) {
	clock := &mockClock{t: time.Unix(100, 0)}
	c := newCounterWithClock(boxMAC, []string{gwMAC}, []string{lan, lan6}, window, threshold, clock.Now)
	c.SetWatched(map[string]string{kidMAC: kidIP})
	return c, clock
}

type mockClock struct {
	t time.Time
}

func (m *mockClock) Now() time.Time {
	return m.t
}

func (m *mockClock) Add(d time.Duration) {
	m.t = m.t.Add(d)
}

func TestIdleDeviceNotResisting(t *testing.T) {
	c, _ := testCounter(3, 30)
	if len(c.Resisting()) != 0 {
		t.Error("idle device should not be resisting")
	}
}

func TestGatewayReturnTrafficThreshold(t *testing.T) {
	c, _ := testCounter(3, 30)
	for i := 0; i < 3; i++ {
		c.Observe(gwMAC, boxMAC, kidIP, inet)
	}
	resisting := c.Resisting()
	if !resisting[kidMAC] {
		t.Error("device should be resisting")
	}
	if tally := c.Tally(kidMAC); tally.FromGateway != 3 {
		t.Errorf("from_gateway = %d, want 3", tally.FromGateway)
	}
}

func TestGatewayReturnTrafficIPv6(t *testing.T) {
	c, _ := testCounter(3, 30)
	c.SetWatched(map[string]string{kidMAC: kidIP6})
	for i := 0; i < 3; i++ {
		c.Observe(gwMAC, boxMAC, kidIP6, inet6)
	}
	if !c.Resisting()[kidMAC] {
		t.Error("IPv6 traffic should be counted")
	}
}

func TestDeviceFramesToBoxDontFlag(t *testing.T) {
	c, _ := testCounter(3, 30)
	for i := 0; i < 5; i++ {
		c.Observe(kidMAC, boxMAC, "", "")
	}
	resisting := c.Resisting()
	if resisting[kidMAC] {
		t.Error("to_box traffic alone should not flag as resisting")
	}
	if tally := c.Tally(kidMAC); tally.ToBox != 5 {
		t.Errorf("to_box = %d, want 5", tally.ToBox)
	}
}

func TestLANSourcedTrafficNeverFlags(t *testing.T) {
	c, _ := testCounter(3, 30)
	for i := 0; i < 5; i++ {
		c.Observe(gwMAC, boxMAC, kidIP, "10.0.0.7")
	}
	if len(c.Resisting()) != 0 {
		t.Error("LAN-sourced traffic should not flag")
	}
	if tally := c.Tally(kidMAC); tally.FromGateway != 0 {
		t.Errorf("from_gateway = %d, want 0", tally.FromGateway)
	}
}

func TestWindowResetsCounts(t *testing.T) {
	c, clock := testCounter(3, 30)
	c.Observe(gwMAC, boxMAC, kidIP, inet)
	c.Observe(gwMAC, boxMAC, kidIP, inet)
	clock.Add(31 * time.Second)
	c.Observe(gwMAC, boxMAC, kidIP, inet)
	if tally := c.Tally(kidMAC); tally.FromGateway != 1 {
		t.Errorf("from_gateway = %d, want 1 (window reset)", tally.FromGateway)
	}
}

func TestUnwatchDropsTally(t *testing.T) {
	c, _ := testCounter(3, 30)
	c.Observe(gwMAC, boxMAC, kidIP, inet)
	c.SetWatched(map[string]string{})
	if tally := c.Tally(kidMAC); tally.FromGateway != 0 {
		t.Error("unwatched MAC should have zero tally")
	}
}

func TestMACCaseInsensitive(t *testing.T) {
	c, _ := testCounter(3, 30)
	c.Observe(gwMAC, boxMAC, kidIP, inet)
	c.Observe(gwMAC, boxMAC, kidIP, inet)
	c.Observe(gwMAC, boxMAC, kidIP, inet)
	if !c.Resisting()[kidMAC] {
		t.Error("case-insensitive MAC matching failed")
	}
}

func TestFramesNotToBoxIgnored(t *testing.T) {
	c, _ := testCounter(3, 30)
	c.Observe(gwMAC, "ee:ee:ee:ee:ee:ee", kidIP, inet)
	if tally := c.Tally(kidMAC); tally.FromGateway != 0 {
		t.Error("frames not to box should be ignored")
	}
}
