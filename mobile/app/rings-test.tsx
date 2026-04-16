/**
 * Ring Test Harness — renders all ring states for visual comparison against
 * the B2a Canvas2D reference (ring-states.html).
 *
 * Navigate to /rings-test in the dev server to see all states.
 * NOT included in production builds (no tab/stack route).
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { PlasmaBlobRing } from '../components/Rings/PlasmaBlobRing';
import { Triskelion } from '../components/Rings/Triskelion';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <View style={styles.cardContent}>{children}</View>
    </View>
  );
}

export default function RingsTest() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>B2a Ring Test Harness</Text>
      <Text style={styles.subtitle}>Compare these against ring-states.html?state=all</Text>

      <Section title="Hero Triskelion — Combined Progress States">
        <Card label="Fresh Start (0/0/0)">
          <Triskelion size={200} progress={{ c: 0, d: 0, r: 0 }} />
        </Card>
        <Card label="Morning (60/0/0)">
          <Triskelion size={200} progress={{ c: 0.6, d: 0, r: 0 }} />
        </Card>
        <Card label="Active (100/40/0)">
          <Triskelion size={200} progress={{ c: 1.0, d: 0.4, r: 0 }} />
        </Card>
        <Card label="Almost (100/80/50)">
          <Triskelion size={200} progress={{ c: 1.0, d: 0.8, r: 0.5 }} />
        </Card>
        <Card label="Complete (100/100/100)">
          <Triskelion size={200} progress={{ c: 1.0, d: 1.0, r: 1.0 }} />
        </Card>
      </Section>

      <Section title="Single Ring Fill States (Catch-up Blue)">
        <Card label="0%">
          <PlasmaBlobRing progress={0} color="#38BDF8" size={150} />
        </Card>
        <Card label="25%">
          <PlasmaBlobRing progress={0.25} color="#38BDF8" size={150} />
        </Card>
        <Card label="50%">
          <PlasmaBlobRing progress={0.5} color="#38BDF8" size={150} />
        </Card>
        <Card label="75%">
          <PlasmaBlobRing progress={0.75} color="#38BDF8" size={150} />
        </Card>
        <Card label="100%">
          <PlasmaBlobRing progress={1.0} color="#38BDF8" size={150} />
        </Card>
      </Section>

      <Section title="All Three Ring Colors at 75%">
        <Card label="Catch-up #38BDF8">
          <PlasmaBlobRing progress={0.75} color="#38BDF8" size={150} />
        </Card>
        <Card label="Dive-in #EC4899">
          <PlasmaBlobRing progress={0.75} color="#EC4899" size={150} />
        </Card>
        <Card label="Recap #FB923C">
          <PlasmaBlobRing progress={0.75} color="#FB923C" size={150} />
        </Card>
      </Section>

      <Section title="Celebration & Over-Goal">
        <Card label="Nexus Wake">
          <Triskelion size={200} progress={{ c: 1.0, d: 1.0, r: 1.0 }} />
        </Card>
        <Card label="Over-Goal Halo">
          <Triskelion size={200} progress={{ c: 1.2, d: 1.1, r: 1.3 }} celebrate />
        </Card>
      </Section>

      <Section title="Size Variants">
        <Card label="Hero (200px)">
          <Triskelion size={200} progress={{ c: 1.0, d: 0.75, r: 0.5 }} />
        </Card>
        <Card label="Logo (40px)">
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Triskelion size={40} progress={{ c: 1.0, d: 0.75, r: 0.5 }} />
            <Text style={styles.sizeNote}>40px actual</Text>
          </View>
        </Card>
        <Card label="Tab Ring (24px)">
          <View style={{ flexDirection: 'row', gap: 24, padding: 40, justifyContent: 'center' }}>
            <View style={{ alignItems: 'center' }}>
              <PlasmaBlobRing progress={0.7} color="#38BDF8" size={24} stroke={2.5} minimal />
              <Text style={styles.sizeNote}>C</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <PlasmaBlobRing progress={0.45} color="#EC4899" size={24} stroke={2.5} minimal />
              <Text style={styles.sizeNote}>D</Text>
            </View>
            <View style={{ alignItems: 'center' }}>
              <PlasmaBlobRing progress={0.25} color="#FB923C" size={24} stroke={2.5} minimal />
              <Text style={styles.sizeNote}>R</Text>
            </View>
          </View>
        </Card>
        <Card label="Mini Triskelion (28px)">
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Triskelion size={28} progress={{ c: 1.0, d: 0.75, r: 0.5 }} />
            <Text style={styles.sizeNote}>28px Home tab</Text>
          </View>
        </Card>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060A12',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  title: {
    fontSize: 22,
    fontWeight: '300',
    color: '#F1F5F9',
    letterSpacing: 1,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(148,163,184,0.5)',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(148,163,184,0.7)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 6,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    backgroundColor: 'rgba(15,20,35,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(241,245,249,0.7)',
    marginBottom: 6,
  },
  cardContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeNote: {
    fontSize: 10,
    color: 'rgba(148,163,184,0.4)',
    marginTop: 6,
  },
});
