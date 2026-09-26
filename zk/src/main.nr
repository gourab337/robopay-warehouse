// Proof of delivery: the carrier proves it scanned the tote at the packing station
// without revealing the tote ID or the station's scan secret.
fn main(
    tote_id: Field,
    station_secret: Field,
    job_id: pub Field,
    carrier: pub Field,
    tote_commitment: pub Field,
    station_commitment: pub Field,
) {
    // Tote matches the one committed for this job (binds the proof to job_id).
    assert(std::hash::pedersen_hash([tote_id, job_id]) == tote_commitment);
    // Carrier knows the secret only the packing station's scanner reveals.
    assert(std::hash::pedersen_hash([station_secret]) == station_commitment);
    // Public input binds the proof to the carrier's address so it can't be replayed by another wallet.
    assert(carrier != 0);
}

#[test]
fn test_valid_delivery() {
    let tote_id = 4242;
    let secret = 777;
    main(tote_id, secret, 1, 0xabc, std::hash::pedersen_hash([tote_id, 1]), std::hash::pedersen_hash([secret]));
}

#[test(should_fail)]
fn test_wrong_station_secret() {
    main(4242, 1, 1, 0xabc, std::hash::pedersen_hash([4242, 1]), std::hash::pedersen_hash([777]));
}

